const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const moment = require('moment-timezone');
const db = require('../database');
const fs = require('fs');
const path = require('path');

let config = {}; 

// učitavanje konfiguracije
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'pollConfig.json');
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('[info] učitana konfiguracija ankete:', config);
    } catch (error) {
      console.error('[greška] neuspjelo učitavanje konfiguracije ankete:', error);
    }
  } else {
    console.log('[info] korištenje zadane konfiguracije ankete');
  }
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
  const endTime = new Date(Date.now() + (isTest ? 60000 : 3600000));
  const pollEmbed = createPollEmbed([], [], endTime);
  const buttons = createPollButtons();

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

    // pohrana ankete u activePolls
    client.activePolls.set(sentMessage.id, {
      messageId: sentMessage.id,
      channelId: channel.id,
      coming: [],
      notComing: [],
      maybe: [],
      votedUsers: new Set(),
      isTest,
      endTime
    });

    console.log(`[info] anketa uspješno stvorena u kanalu ${channel.name} (${channel.id}).`);

    // ažuriranje ankete svakih 15 sekundi za prikaz preostalog vremena
    const updateInterval = setInterval(async () => {
      try {
        const poll = client.activePolls.get(sentMessage.id);
        if (poll) {
          const updatedEmbed = createPollEmbed(poll.coming, poll.notComing, poll.endTime, poll.maybe);
          await sentMessage.edit({ 
            content: roleMentions,
            embeds: [updatedEmbed],
            components: [buttons]
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

    // Brojač grešaka za interval
    let errorCount = 0;

    // automatsko brisanje ankete
    const deleteTimeout = isTest ? 60000 : 3600000; // 1 minuta ili 1 sat
    
    setTimeout(async () => {
      clearInterval(updateInterval);
      try {
        const poll = client.activePolls.get(sentMessage.id);
        if (poll) {
          const comingCount = poll.coming.length;
          const logMessage = `${isTest ? '[test] ' : ''}Danas je **${comingCount}** ljudi došlo na robotiku.`;
          
          // Bilježenje prisutnosti se ne radi ovdje jer se već bilježi u handlePollButtonInteraction
          
          // dohvaćanje ukupne statistike prisutnosti i prikaz poruke
          if (!isTest) {
            const stats = await db.getAllAttendanceStats();
            const topAttendees = stats.slice(0, 3).map(stat => 
              `${stat.username}: ${stat.total_attendance} dolazaka`
            ).join('\n');

            const statsMessage = `${logMessage}\n\nNajaktivniji članovi:\n${topAttendees}`;
            await channel.send(statsMessage);
          } else {
            await channel.send(logMessage);
          }
          
          console.log(`[info] anketa završena: ${logMessage}`);

          await sentMessage.delete();
          client.activePolls.delete(sentMessage.id);
          console.log(`[info] anketa u kanalu ${channel.name} (${channel.id}) uspješno obrisana.`);
        }
      } catch (error) {
        console.error(`[greška] greška prilikom brisanja ankete u kanalu ${channel.name} (${channel.id}):`, error);
        // Osiguraj da se anketa ukloni iz aktivnih anketa čak i ako dođe do greške
        client.activePolls.delete(sentMessage.id);
      }
    }, deleteTimeout);

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
  client.activePolls.delete(pollId);
}

async function handlePollButtonInteraction(interaction, poll, client) {
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  // pohrana početnog stanja za određivanje je li ovo prvi glas ili promjena
  const isFirstVote = !poll.votedUsers.has(userId);

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
      await db.recordAttendance(userId, userName, true);
    }
  } else if (interaction.customId === 'not_coming') {
    poll.notComing.push(userName);
    updated = true;
    console.log(`[info] korisnik ${userName} (${userId}) je glasao "ne dolazim".`);
    if (!poll.isTest) {
      await db.recordAttendance(userId, userName, false);
    }
  } else if (interaction.customId === 'maybe') {
    poll.maybe.push(userName);
    updated = true;
    console.log(`[info] korisnik ${userName} (${userId}) je glasao "možda".`);
    // Ne bilježimo prisutnost za "možda" jer nije jasno je li korisnik došao ili ne
  }

  // dodavanje u glasače ako je ovo njihov prvi glas
  if (isFirstVote) {
    poll.votedUsers.add(userId);
  }

  if (updated) {
    const updatedEmbed = createPollEmbed(poll.coming, poll.notComing, poll.endTime, poll.maybe);
    const buttons = createPollButtons(poll.coming.length, poll.notComing.length, poll.maybe.length);

    await interaction.update({
      embeds: [updatedEmbed],
      components: [buttons],
    });

    console.log(`[info] anketa ažurirana za korisnika ${userName} (${userId}).`);
  }
}

// ažuriranje createPollButtons za uključivanje brojača
function createPollButtons(comingCount = 0, notComingCount = 0, maybeCount = 0) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: 'coming',
        label: `✅ Dolazim! (${comingCount})`,
        style: 3,
      },
      {
        type: 2,
        custom_id: 'not_coming',
        label: `❌ Ne dolazim (${notComingCount})`,
        style: 4,
      },
      {
        type: 2,
        custom_id: 'maybe',
        label: `❓ Možda (${maybeCount})`,
        style: 1,
      },
    ],
  };
}

// Premješteno prije module.exports za bolju organizaciju koda
function createPollEmbed(coming = [], notComing = [], endTime, maybe = []) {
  const comingList = coming.length > 0 ? coming.join('\n') : 'Nema';
  const notComingList = notComing.length > 0 ? notComing.join('\n') : 'Nema';
  const maybeList = maybe.length > 0 ? maybe.join('\n') : 'Nema';
  
  // izračun preostalog vremena
  const now = new Date();
  const timeLeft = endTime - now;
  const minutesLeft = Math.max(0, Math.floor(timeLeft / 60000));
  const secondsLeft = Math.max(0, Math.floor((timeLeft % 60000) / 1000));
  const timeLeftString = `${minutesLeft}m ${secondsLeft}s`;

  return {
    title: 'Robotika danas ',
    description:
      'Dolazite li na robotiku danas?\n\n' +
      'Kliknite gumb ispod kako biste označili svoj status.',
    fields: [
      { name: '⏰ Vrijeme', value: 'Robotika počinje u **17:00**', inline: true },
      { name: '📅 Datum', value: `<t:${Math.floor(Date.now() / 1000)}:D>`, inline: true },
      { name: '⌛ Preostalo vrijeme', value: timeLeftString, inline: true },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: '✅ Dolazim', value: comingList, inline: true },
      { name: '❌ Ne dolazim', value: notComingList, inline: true },
      { name: '❓ Možda', value: maybeList, inline: true },
    ],
    color: parseInt('0099ff', 16),
    footer: { text: `Anketa se automatski briše za ${timeLeftString}` },
    timestamp: new Date(),
  };
}

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
    console.log('[debug] inicijalizacija anketa naredbe i zakazivanje cron posla...');
    
    // učitavanje konfiguracije
    loadConfig();
    
    // stvaranje cron rasporeda iz konfiguracije
    const [hours, minutes] = config.pollTime.split(':');
    const cronSchedule = `${minutes} ${hours} * * ${config.pollDay}`;
    
    console.log(`[debug] zakazivanje za ${config.pollDay} u ${config.pollTime}`);
    cron.schedule(cronSchedule, async () => {
      console.log('[debug] cron posao pokrenut u:', new Date().toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb' }));
      const channel = client.channels.cache.get(config.pollChannelId);
      if (!channel) {
        console.error('[greška] kanal nije pronađen.');
        return;
      }
      await createAndHandlePoll(channel, client, false);
    }, {
      timezone: 'Europe/Zagreb',
    });
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
        await interaction.editReply('✅ Test anketa je stvorena.');
      } catch (error) {
        await interaction.editReply(`❌ ${error.message}`);
      }
      return;
    }

    if (subcommand === 'end') {
      try {
        await interaction.deferReply();
        const poll = Array.from(interaction.client.activePolls.values())
          .find(p => p.channelId === interaction.channel.id);
        
        if (!poll) {
          await interaction.editReply('❌ Nema aktivne ankete u ovom kanalu.');
          return;
        }

        await endPoll(poll.messageId, interaction.client);
        await interaction.editReply('✅ Anketa je uspješno završena.');
      } catch (error) {
        await interaction.editReply(`❌ Greška: ${error.message}`);
      }
      return;
    }

    // info subcommand
    if (subcommand === 'info') {
      const infoEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('ℹ️ Informacije o Anketama')
        .setDescription('Dobrodošli u sustav za automatske ankete!')
        .addFields(
          {
            name: '📅 Automatske Ankete',
            value: 'Ankete se automatski šalju prema konfiguriranom rasporedu.\nKoristite `/setup` za promjenu postavki.',
            inline: false
          },
          {
            name: '⏰ Trajanje',
            value: 'Test ankete: 1 minuta\nRedovne ankete: 1 sat',
            inline: true
          },
          {
            name: '🔄 Ažuriranje',
            value: 'Ankete se automatski ažuriraju svakih 15 sekundi',
            inline: true
          }
        )
        .setFooter({ 
          text: 'Za dodatnu pomoć kontaktirajte filipa'
        })
        .setTimestamp();

      await interaction.reply({ embeds: [infoEmbed] });
      return;
    }
  },
  handlePollButtonInteraction,
  createPollButtons,
  createPollEmbed,
};