const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const moment = require('moment-timezone');
const db = require('../database');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  pollChannelId: null,
  pollDay: 3,
  pollTime: '17:00', // vrijeme početka radionice
  sessionEndTime: '19:00', // vrijeme završetka radionice
  mentionRoles: [],
  timezone: 'Europe/Zagreb',
};

let config = { ...DEFAULT_CONFIG };
let pollCronJobs = [];
const DAY_NAMES = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota'];

// učitavanje konfiguracije
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'pollConfig.json');
  if (fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = {
        ...DEFAULT_CONFIG,
        ...fileConfig,
      };

      if (!Array.isArray(config.mentionRoles)) {
        config.mentionRoles = [];
      }

      console.log('[info] učitana konfiguracija ankete:', config);
    } catch (error) {
      console.error('[greška] neuspjelo učitavanje konfiguracije ankete:', error);
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    console.log('[info] korištenje zadane konfiguracije ankete');
    config = { ...DEFAULT_CONFIG };
  }
}

function parseTimeString(timeStr = '00:00') {
  const [hours = 0, minutes = 0] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

function normalizeDay(day) {
  if (day === undefined || day === null) {
    return 0;
  }
  return day === 7 ? 0 : day;
}

function getSessionDay() {
  return normalizeDay(config.pollDay);
}

function getSessionEndDay() {
  const startMinutes = getMinutesFromTime(config.pollTime);
  const endMinutes = getMinutesFromTime(config.sessionEndTime);
  const offset = endMinutes >= startMinutes ? 0 : 1;
  const normalized = (getSessionDay() + offset) % 7;
  return normalized;
}

function getMinutesFromTime(timeStr = '00:00') {
  const { hours, minutes } = parseTimeString(timeStr);
  return hours * 60 + minutes;
}

function getMomentForOccurrence(day, timeStr, nowMoment, direction = 'next') {
  const { hours, minutes } = parseTimeString(timeStr);
  let target = nowMoment.clone().day(day).hour(hours).minute(minutes).second(0).millisecond(0);

  if (direction === 'next' && target.isBefore(nowMoment)) {
    target = target.add(7, 'days');
  }

  if (direction === 'previous' && target.isAfter(nowMoment)) {
    target = target.subtract(7, 'days');
  }

  return target;
}

function getSessionEndFromStart(startMoment) {
  const { hours, minutes } = parseTimeString(config.sessionEndTime);
  let endMoment = startMoment.clone().hour(hours).minute(minutes).second(0).millisecond(0);
  if (endMoment.isSameOrBefore(startMoment)) {
    endMoment = endMoment.add(1, 'day');
  }
  return endMoment;
}

function getNextSessionStartMoment(nowMoment = moment.tz(config.timezone)) {
  return getMomentForOccurrence(getSessionDay(), config.pollTime, nowMoment, 'next');
}

function getNextSessionStart(nowMoment = moment.tz(config.timezone)) {
  return getNextSessionStartMoment(nowMoment).toDate();
}

function getPreviousSessionStartMoment(nowMoment = moment.tz(config.timezone)) {
  return getMomentForOccurrence(getSessionDay(), config.pollTime, nowMoment, 'previous');
}

function getNextSessionEnd(nowMoment = moment.tz(config.timezone)) {
  const previousStart = getPreviousSessionStartMoment(nowMoment);
  const previousEnd = getSessionEndFromStart(previousStart);

  if (nowMoment.isBefore(previousEnd)) {
    return previousEnd.toDate();
  }

  const nextStart = getNextSessionStartMoment(nowMoment);
  const nextEnd = getSessionEndFromStart(nextStart);
  return nextEnd.toDate();
}

function isDuringSession(nowMoment = moment.tz(config.timezone)) {
  const previousStart = getPreviousSessionStartMoment(nowMoment);
  const sessionEnd = getSessionEndFromStart(previousStart);
  return nowMoment.isSameOrAfter(previousStart) && nowMoment.isBefore(sessionEnd);
}

function getDayName(day) {
  const normalized = normalizeDay(day);
  return DAY_NAMES[normalized] || DAY_NAMES[0];
}

function formatDiscordTimestamp(date, style = 'F') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'uskoro';
  }
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function formatTimeLeft(endTime) {
  if (!(endTime instanceof Date)) {
    return 'N/A';
  }

  const diffMs = Math.max(0, endTime.getTime() - Date.now());
  const duration = moment.duration(diffMs);
  const days = Math.floor(duration.asDays());
  const hours = duration.hours();
  const minutes = duration.minutes();

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

// pomoćna funkcija za stvaranje i upravljanje anketom
async function createAndHandlePoll(channel, client, isTest = false) {
  // provjera postoji li već aktivna anketa u ovom kanalu
  const existingPoll = Array.from(client.activePolls.values())
    .find(poll => poll.channelId === channel.id);
  
  if (existingPoll) {
    throw new Error('Već postoji aktivna anketa u ovom kanalu.');
  }

  console.log(`[info] stvaranje ${isTest ? 'test' : 'zakazane'} ankete...`);
  const isSessionActive = !isTest && isDuringSession(moment.tz(config.timezone));
  const endTime = isTest ? new Date(Date.now() + 60000) : getNextSessionStart();
  const pollEmbed = createPollEmbed([], [], endTime, [], {
    isOpen: !isSessionActive || isTest,
    resumeAt: isSessionActive ? getNextSessionEnd(moment.tz(config.timezone)) : null,
  });
  const buttons = createPollButtons(0, 0, 0, isSessionActive && !isTest);

  try {
    // stvaranje spominjanja uloga ako su konfigurirane
    const roleMentions = !isTest && config.mentionRoles.length > 0
      ? config.mentionRoles.map(id => `<@&${id}>`).join(' ') + '\n'
      : '';

    const sentMessage = await channel.send({
      content: roleMentions,
      embeds: [pollEmbed],
      components: [buttons]
    });

    let errorCount = 0;
    const updateInterval = setInterval(async () => {
      try {
        const poll = client.activePolls.get(sentMessage.id);
        if (poll) {
          const updatedEmbed = createPollEmbed(
            poll.coming,
            poll.notComing,
            poll.endTime,
            poll.maybe,
            { isOpen: poll.isOpen, resumeAt: poll.resumeAt }
          );
          const updatedButtons = createPollButtons(
            poll.coming.length,
            poll.notComing.length,
            poll.maybe.length,
            !poll.isOpen
          );
          
          await sentMessage.edit({ 
            content: poll.roleMentions,
            embeds: [updatedEmbed],
            components: [updatedButtons], // Koristimo ažurirane gumbe s ispravnim brojačima
          });
        } else {
          // Ako anketa više ne postoji, očisti interval
          clearInterval(updateInterval);
        }
      } catch (error) {
        console.error('[greška] neuspjelo ažuriranje ankete:', error);
        // Ako dođe do greške 3 puta zaredom, očisti interval
        if (++errorCount >= 3) {
          console.error('[greška] previše grešaka, prekid ažuriranja ankete');
          clearInterval(updateInterval);
        }
      }
    }, 15000);

    const pollData = {
      messageId: sentMessage.id,
      channelId: channel.id,
      coming: [],
      notComing: [],
      maybe: [],
      votedUsers: new Set(),
      userStatus: new Map(),
      isTest,
      endTime,
      isOpen: !isSessionActive || isTest,
      resumeAt: isSessionActive ? getNextSessionEnd(moment.tz(config.timezone)) : null,
      roleMentions,
      updateInterval,
    };

    client.activePolls.set(sentMessage.id, pollData);

    console.log(`[info] anketa uspješno stvorena u kanalu ${channel.name} (${channel.id}).`);

    if (isTest) {
      setTimeout(async () => {
        clearInterval(updateInterval);
        try {
          const poll = client.activePolls.get(sentMessage.id);
          if (poll) {
            const comingCount = poll.coming.length;
            const logMessage = `${isTest ? '[test] ' : ''}Danas je **${comingCount}** ljudi došlo na robotiku.`;

            await channel.send(logMessage);
            await sentMessage.delete();
            client.activePolls.delete(sentMessage.id);
          }
        } catch (error) {
          console.error('[greška] greška prilikom automatskog brisanja test ankete:', error);
        }
      }, 60000);
    }

    return sentMessage.id;
  } catch (error) {
    console.error(`[greška] greška prilikom slanja ankete u kanalu ${channel.name} (${channel.id}):`, error);
    throw error;
  }
}

// pomoćna funkcija za ranije završavanje ankete
async function endPoll(pollId, client) {
  const poll = client.activePolls.get(pollId);
  if (!poll) {
    throw new Error('Anketa nije pronađena.');
  }

  const channel = client.channels.cache.get(poll.channelId);
  if (!channel) {
    throw new Error('Kanal nije pronađen.');
  }

  const message = await channel.messages.fetch(pollId);
  if (!message) {
    throw new Error('Poruka nije pronađena.');
  }

  // pokretanje iste logike kao i timeout
  const comingCount = poll.coming.length;
  const logMessage = `${poll.isTest ? '[test] ' : ''}Anketa završena ranije. Danas je **${comingCount}** ljudi došlo na robotiku.`;
  
  await channel.send(logMessage);
  await message.delete();
  if (poll.updateInterval) {
    clearInterval(poll.updateInterval);
  }
  client.activePolls.delete(pollId);
}

async function handlePollButtonInteraction(interaction, poll, client) {
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  if (!poll.isTest && poll.isOpen === false) {
    await interaction.reply({
      content: 'Anketa je trenutno pauzirana dok radionica traje. Vratite se nakon završetka.',
      ephemeral: true,
    });
    return;
  }

  // pohrana početnog stanja za određivanje je li ovo prvi glas ili promjena
  const isFirstVote = !poll.votedUsers.has(userId);
  
  // Inicijalizacija userStatus Mape ako ne postoji (za kompatibilnost s postojećim anketama)
  if (!poll.userStatus) {
    poll.userStatus = new Map();
  }
  
  // Dohvaćamo trenutni status korisnika (ako postoji)
  const currentStatus = poll.userStatus.get(userId);
  const newStatus = interaction.customId;
  
  // Provjera pokušava li korisnik odabrati isti status
  if (currentStatus === newStatus) {
    await interaction.reply({
      content: `Vec ste odabrali status "${newStatus === 'coming' ? 'Dolazim' : newStatus === 'not_coming' ? 'Ne dolazim' : 'Možda'}"!`,
      ephemeral: true
    });
    return;
  }

  let updated = false;
  // prvo uklanjanje iz svih lista
  poll.coming = poll.coming.filter(name => name !== userName);
  poll.notComing = poll.notComing.filter(name => name !== userName);
  poll.maybe = poll.maybe.filter(name => name !== userName);

  // bilježenje novog glasa
  if (interaction.customId === 'coming') {
    poll.coming.push(userName);
    updated = true;
    console.log(`[info] korisnik ${userName} (${userId}) je glasao "dolazim".`);
    if (!poll.isTest) {
      // Bilježimo dolazak samo ako je promjena statusa
      if (currentStatus !== 'coming') {
        await db.recordAttendance(userId, userName, true);
      }
    }
    // Postavljanje trenutnog statusa korisnika
    poll.userStatus.set(userId, 'coming');
  } else if (interaction.customId === 'not_coming') {
    poll.notComing.push(userName);
    updated = true;
    console.log(`[info] korisnik ${userName} (${userId}) je glasao "ne dolazim".`);
    if (!poll.isTest) {
      // Bilježimo nedolazak samo ako je promjena statusa
      if (currentStatus !== 'not_coming') {
        await db.recordAttendance(userId, userName, false);
      }
    }
    // Postavljanje trenutnog statusa korisnika
    poll.userStatus.set(userId, 'not_coming');
  } else if (interaction.customId === 'maybe') {
    poll.maybe.push(userName);
    updated = true;
    console.log(`[info] korisnik ${userName} (${userId}) je glasao "možda".`);
    // Ne bilježimo prisutnost za "možda" jer nije jasno je li korisnik došao ili ne
    
    // Postavljanje trenutnog statusa korisnika
    poll.userStatus.set(userId, 'maybe');
  }

  // dodavanje u glasače ako je ovo njihov prvi glas
  if (isFirstVote) {
    poll.votedUsers.add(userId);
  }

  if (updated) {
    const updatedEmbed = createPollEmbed(
      poll.coming,
      poll.notComing,
      poll.endTime,
      poll.maybe,
      { isOpen: poll.isOpen, resumeAt: poll.resumeAt }
    );
    const buttons = createPollButtons(
      poll.coming.length,
      poll.notComing.length,
      poll.maybe.length,
      !poll.isOpen
    );

    await interaction.update({
      embeds: [updatedEmbed],
      components: [buttons],
    });

    console.log(`[info] anketa ažurirana za korisnika ${userName} (${userId}).`);
  }
}

function getManagedPoll(client) {
  return Array.from(client.activePolls.values())
    .find(p => p.channelId === config.pollChannelId && !p.isTest);
}

async function pausePollForSession(client, { silent = false } = {}) {
  if (!config.pollChannelId) {
    console.warn('[upozorenje] pollChannelId nije postavljen u konfiguraciji.');
    return;
  }

  const poll = getManagedPoll(client);
  if (!poll) {
    console.log('[debug] nema aktivne ankete za pauziranje.');
    return;
  }

  if (poll.isOpen === false) {
    console.log('[debug] anketa je već pauzirana.');
    return;
  }

  const channel = client.channels.cache.get(poll.channelId);
  if (!channel) {
    console.error('[greška] kanal nije pronađen za pauziranje ankete.');
    return;
  }

  let message;
  try {
    message = await channel.messages.fetch(poll.messageId);
  } catch (error) {
    console.error('[greška] ne mogu dohvatiti poruku ankete za pauziranje:', error);
    client.activePolls.delete(poll.messageId);
    return;
  }

  const nowMoment = moment.tz(config.timezone);
  const currentStart = getPreviousSessionStartMoment(nowMoment);
  const resumeMoment = getSessionEndFromStart(currentStart);
  const nextStartMoment = currentStart.clone().add(7, 'days');

  poll.isOpen = false;
  poll.resumeAt = resumeMoment.toDate();
  poll.endTime = nextStartMoment.toDate();

  const comingCount = poll.coming.length;
  if (!silent) {
    const logMessage = `Radionica je počela! Danas je prijavljeno **${comingCount}** dolazaka.`;
    try {
      const stats = await db.getAllAttendanceStats();
      const topAttendees = stats.slice(0, 3).map(stat => `${stat.username}: ${stat.total_attendance} dolazaka`).join('\n') || 'Nema podataka.';
      await channel.send(`${logMessage}\n\nNajaktivniji članovi:\n${topAttendees}`);
    } catch (error) {
      console.error('[greška] neuspjelo slanje statistike prilikom pauziranja ankete:', error);
      await channel.send(logMessage);
    }
  }

  const updatedEmbed = createPollEmbed(
    poll.coming,
    poll.notComing,
    poll.endTime,
    poll.maybe,
    { isOpen: false, resumeAt: poll.resumeAt }
  );
  const buttons = createPollButtons(
    poll.coming.length,
    poll.notComing.length,
    poll.maybe.length,
    true
  );

  await message.edit({
    content: poll.roleMentions,
    embeds: [updatedEmbed],
    components: [buttons],
  });

  console.log('[info] anketa je pauzirana za vrijeme radionice.');
}

async function resumePollForNextWeek(client, { notify = true } = {}) {
  if (!config.pollChannelId) {
    console.warn('[upozorenje] pollChannelId nije postavljen u konfiguraciji.');
    return;
  }

  const channel = client.channels.cache.get(config.pollChannelId);
  if (!channel) {
    console.error('[greška] kanal nije pronađen za ponovno otvaranje ankete.');
    return;
  }

  const poll = getManagedPoll(client);
  if (!poll) {
    console.log('[info] nema pronađene ankete - kreiram novu.');
    await createAndHandlePoll(channel, client, false);
    return;
  }

  let message;
  try {
    message = await channel.messages.fetch(poll.messageId);
  } catch (error) {
    console.error('[greška] ne mogu dohvatiti poruku ankete za ponovno otvaranje:', error);
    client.activePolls.delete(poll.messageId);
    await createAndHandlePoll(channel, client, false);
    return;
  }

  poll.coming = [];
  poll.notComing = [];
  poll.maybe = [];
  poll.votedUsers = new Set();
  poll.userStatus = new Map();
  poll.isOpen = true;
  poll.resumeAt = null;
  poll.endTime = getNextSessionStart(moment.tz(config.timezone));

  const updatedEmbed = createPollEmbed([], [], poll.endTime, [], { isOpen: true });
  const buttons = createPollButtons(0, 0, 0, false);

  await message.edit({
    content: poll.roleMentions,
    embeds: [updatedEmbed],
    components: [buttons],
  });

  if (notify) {
    const mention = (poll.roleMentions || '').trim();
    const infoMessage = `${mention ? mention + '\n' : ''}Anketa je ponovno otvorena! Prijavite dolazak za sljedeću radionicu.`;
    await channel.send(infoMessage);
  }

  console.log('[info] anketa je ponovno otvorena za novi tjedan.');
}

function stopScheduledJobs() {
  pollCronJobs.forEach(job => job.stop());
  pollCronJobs = [];
}

function schedulePollCronJobs(client) {
  stopScheduledJobs();

  if (!config.pollChannelId) {
    console.warn('[upozorenje] Nije moguće zakazati ankete bez postavljenog kanala.');
    return;
  }

  const { hours: startHour, minutes: startMinute } = parseTimeString(config.pollTime);
  const closeSchedule = `${startMinute} ${startHour} * * ${config.pollDay}`;
  console.log(`[debug] zakazivanje pauziranja ankete: ${closeSchedule} (${config.timezone})`);

  const closeJob = cron.schedule(closeSchedule, async () => {
    console.log('[debug] cron posao (pauza ankete) pokrenut.');
    try {
      await pausePollForSession(client);
    } catch (error) {
      console.error('[greška] cron pauza ankete nije uspjela:', error);
    }
  }, { timezone: config.timezone });

  pollCronJobs.push(closeJob);

  const { hours: endHour, minutes: endMinute } = parseTimeString(config.sessionEndTime);
  const endDay = getSessionEndDay();
  const openSchedule = `${endMinute} ${endHour} * * ${endDay}`;
  console.log(`[debug] zakazivanje ponovnog otvaranja ankete: ${openSchedule} (${config.timezone})`);

  const openJob = cron.schedule(openSchedule, async () => {
    console.log('[debug] cron posao (ponovno otvaranje) pokrenut.');
    try {
      await resumePollForNextWeek(client);
    } catch (error) {
      console.error('[greška] cron ponovno otvaranje ankete nije uspjelo:', error);
    }
  }, { timezone: config.timezone });

  pollCronJobs.push(openJob);
}

async function ensurePollLifecycleState(client) {
  if (!config.pollChannelId) {
    return;
  }

  const channel = client.channels.cache.get(config.pollChannelId);
  if (!channel) {
    console.error('[greška] kanal definiran u konfiguraciji nije pronađen.');
    return;
  }

  const nowMoment = moment.tz(config.timezone);
  const poll = getManagedPoll(client);

  if (isDuringSession(nowMoment)) {
    if (poll && poll.isOpen) {
      await pausePollForSession(client, { silent: true });
    }
  } else if (!poll) {
    await createAndHandlePoll(channel, client, false);
  } else if (!poll.isOpen) {
    await resumePollForNextWeek(client, { notify: false });
  }
}

// ažuriranje createPollButtons za uključivanje brojača i onemogućavanje tijekom radionice
function createPollButtons(comingCount = 0, notComingCount = 0, maybeCount = 0, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: 'coming',
        label: `✅ Dolazim (${comingCount})`,
        style: 3,
        disabled,
      },
      {
        type: 2,
        custom_id: 'not_coming',
        label: `❌ Ne dolazim (${notComingCount})`,
        style: 4,
        disabled,
      },
      {
        type: 2,
        custom_id: 'maybe',
        label: `❓ Možda (${maybeCount})`,
        style: 1,
        disabled,
      },
    ],
  };
}

// Premješteno prije module.exports za bolju organizaciju koda
function createPollEmbed(coming = [], notComing = [], endTime, maybe = [], options = {}) {
  const comingList = coming.length > 0 ? coming.join('\n') : 'Nema';
  const notComingList = notComing.length > 0 ? notComing.join('\n') : 'Nema';
  const maybeList = maybe.length > 0 ? maybe.join('\n') : 'Nema';

  const { isOpen = true, resumeAt = null } = options;
  const nextSessionTimestamp = formatDiscordTimestamp(endTime, 'F');
  const resumeTimestamp = resumeAt ? formatDiscordTimestamp(resumeAt, 'F') : nextSessionTimestamp;
  const timeLeftString = formatTimeLeft(endTime);

  const statusValue = isOpen
    ? `Anketa je otvorena do ${nextSessionTimestamp}.`
    : `Radionica je u tijeku. Nastavljamo ${resumeTimestamp}.`;

  return {
    title: 'Robotika - tjedna anketa',
    description: 'Recite mentorima dolazite li na sljedeću radionicu. Gumb možete kliknuti kad god promijenite mišljenje.',
    fields: [
      { name: 'Sljedeća radionica', value: nextSessionTimestamp, inline: true },
      { name: 'Početak', value: `${config.pollTime} (${getDayName(config.pollDay)})`, inline: true },
      { name: 'Kraj', value: `${config.sessionEndTime}`, inline: true },
      { name: 'Status', value: `${statusValue}\nPreostalo vrijeme: **${timeLeftString}**`, inline: false },
      { name: '✅ Dolazim', value: comingList, inline: true },
      { name: '❌ Ne dolazim', value: notComingList, inline: true },
      { name: '❓ Možda', value: maybeList, inline: true },
    ],
    color: isOpen ? parseInt('00b894', 16) : parseInt('d63031', 16),
    footer: { text: isOpen ? 'Anketa se privremeno pauzira kada radionica započne.' : 'Hvala svima koji su došli! Anketa se uskoro ponovno otvara.' },
    timestamp: new Date(),
  };
}

const testables = {
  DEFAULT_CONFIG,
  parseTimeString,
  normalizeDay,
  getSessionDay,
  getSessionEndDay,
  getMinutesFromTime,
  getMomentForOccurrence,
  getSessionEndFromStart,
  getNextSessionStartMoment,
  getNextSessionStart,
  getPreviousSessionStartMoment,
  getNextSessionEnd,
  isDuringSession,
  getDayName,
  formatDiscordTimestamp,
  formatTimeLeft,
  createPollEmbed,
  createPollButtons,
  createAndHandlePoll,
  pausePollForSession,
  resumePollForNextWeek,
  ensurePollLifecycleState,
  getConfig: () => ({ ...config }),
  setConfig: (overrides = {}) => { config = { ...config, ...overrides }; },
  resetConfig: () => { config = { ...DEFAULT_CONFIG }; },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anketa')
    .setDescription('Upravljanje anketama za robotiku')
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('Prikazuje informacije o automatskim anketama'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Stvara test anketu u trenutnom kanalu (traje 1 minutu) (samo za admine)'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('Završava aktivnu anketu u trenutnom kanalu (samo za admine)')),

  init: (client) => {
    console.log('[debug] inicijalizacija anketa naredbe i zakazivanje cron poslova...');

    loadConfig();
    schedulePollCronJobs(client);

    ensurePollLifecycleState(client)
      .catch(error => console.error('[greška] inicijalizacija stanja ankete nije uspjela:', error));
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // provjera administratorskih dozvola za test i end naredbe
    if ((subcommand === 'test' || subcommand === 'end') && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: 'Nemate dozvolu za korištenje ove naredbe. Potrebna je administratorska dozvola.',
        ephemeral: true 
      });
    }

    if (subcommand === 'test') {
      try {
        await interaction.deferReply();
        await createAndHandlePoll(interaction.channel, interaction.client, true);
        await interaction.editReply('Test anketa je stvorena.');
      } catch (error) {
        await interaction.editReply(`Greška: ${error.message}`);
      }
      return;
    }

    if (subcommand === 'end') {
      try {
        await interaction.deferReply();
        const poll = Array.from(interaction.client.activePolls.values())
          .find(p => p.channelId === interaction.channel.id);
        
        if (!poll) {
          await interaction.editReply('Nema aktivne ankete u ovom kanalu.');
          return;
        }

        await endPoll(poll.messageId, interaction.client);
        await interaction.editReply('Anketa je uspješno završena.');
      } catch (error) {
        await interaction.editReply(`Greška: ${error.message}`);
      }
      return;
    }

    // info subcommand
    if (subcommand === 'info') {
      const infoEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('Informacije o anketama')
        .setDescription('Osnovne upute za automatske ankete.')
        .addFields(
          {
            name: 'Automatske ankete',
            value: [
              'Otvorene su cijeli tjedan i pauziraju se tijekom radionice.',
              'Koristi `/setup` za odabir kanala, dana i vremena.'
            ].join('\n'),
            inline: false
          },
          {
            name: 'Trajanje',
            value: [
              'Test anketa traje 1 minutu.',
              'Redovna anketa: otvorena 7 dana uz pauzu tijekom radionice.'
            ].join('\n'),
            inline: true
          },
          {
            name: 'Ažuriranje',
            value: 'Brojevi se osvježavaju svakih 15 sekundi.',
            inline: true
          }
        )
        .setFooter({ 
          text: 'Za dodatnu pomoć kontaktirajte Filipa.'
        })
        .setTimestamp();

      await interaction.reply({ embeds: [infoEmbed] });
      return;
    }
  },
  handlePollButtonInteraction,
  createPollButtons,
  createPollEmbed,
  __testables: testables,
};
