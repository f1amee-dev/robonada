const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const fs = require('fs');
const path = require('path');

// Učitavanje konfiguracije
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'pollConfig.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.error('[greška] neuspjelo učitavanje konfiguracije:', error);
      return { adminUserIds: [] };
    }
  } else {
    return { adminUserIds: [] };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statistika')
    .setDescription('Upravljanje statistikom dolazaka')
    .addSubcommand(subcommand =>
      subcommand
        .setName('prikaz')
        .setDescription('Prikazuje vašu statistiku prisutnosti'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset')
        .setDescription('Resetiranje statistike dolazaka za sve korisnike (samo za administratore)')
        .addBooleanOption(option =>
          option
            .setName('potvrda')
            .setDescription('Potvrda da želite izbrisati SVE podatke o dolascima')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('postavi')
        .setDescription('Postavljanje broja dolazaka za korisnika (samo za administratore)')
        .addUserOption(option => 
          option
            .setName('korisnik')
            .setDescription('Korisnik kojem se postavlja broj dolazaka')
            .setRequired(true))
        .addIntegerOption(option => 
          option
            .setName('broj')
            .setDescription('Broj dolazaka za postavljanje')
            .setRequired(true)
            .setMinValue(0))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Subcommand za pregled statistike - dostupan svima
    if (subcommand === 'prikaz') {
      try {
        const stats = await db.getAttendanceStats(interaction.user.id);
        
        const statsEmbed = {
          title: 'Vaša statistika prisutnosti',
          description: `Došli ste na robotiku **${stats.total_attendance || 0}** puta.`,
          color: parseInt('0099ff', 16),
          timestamp: new Date(),
          footer: { text: 'Statistika se ažurira automatski nakon svake robotike.' },
          fields: []
        };

        if (stats.last_attended) {
          statsEmbed.fields.push({
            name: 'Zadnji put',
            value: `<t:${Math.floor(new Date(stats.last_attended).getTime() / 1000)}:D>`,
            inline: true
          });
        }

        await interaction.reply({ embeds: [statsEmbed] });
        return;
      } catch (error) {
        console.error('[greška] prilikom dohvaćanja statistike:', error);
        await interaction.reply({ 
          content: 'Došlo je do greške prilikom dohvaćanja statistike.',
          ephemeral: true 
        });
        return;
      }
    }

    // Za admin subcommands, provjeri je li korisnik admin
    const config = loadConfig();
    const userId = interaction.user.id;
    
    // Provjera ima li korisnik ovlasti za korištenje naredbe
    if (!config.adminUserIds.includes(userId)) {
      return interaction.reply({
        content: 'Nemate ovlasti za korištenje ove naredbe. Samo administratori bota mogu koristiti ovu naredbu.',
        ephemeral: true
      });
    }

    if (subcommand === 'reset') {
      // Dodatna provjera potvrde za resetiranje
      const isConfirmed = interaction.options.getBoolean('potvrda');
      if (!isConfirmed) {
        return interaction.reply({
          content: 'Morate potvrditi da želite resetirati statistiku tako da postavite opciju potvrde na "True".',
          ephemeral: true
        });
      }

      // Implementacija resetiranja statistike
      await interaction.deferReply({ ephemeral: true });
      try {
        await db.resetAllAttendanceStats();
        await interaction.editReply('Statistika dolazaka je resetirana za sve korisnike.');
      } catch (error) {
        console.error('[greška] greška prilikom resetiranja statistike:', error);
        await interaction.editReply('Došlo je do greške prilikom resetiranja statistike.');
      }
    } else if (subcommand === 'postavi') {
      // Implementacija postavljanja broja dolazaka za korisnika
      const targetUser = interaction.options.getUser('korisnik');
      const attendanceCount = interaction.options.getInteger('broj');
      
      await interaction.deferReply({ ephemeral: true });
      try {
        await db.setUserAttendance(targetUser.id, targetUser.username, attendanceCount);
        await interaction.editReply(`Broj dolazaka za korisnika ${targetUser.username} postavljen je na ${attendanceCount}.`);
      } catch (error) {
        console.error('[greška] greška prilikom postavljanja broja dolazaka:', error);
        await interaction.editReply('Došlo je do greške prilikom postavljanja broja dolazaka.');
      }
    }
  }
};
