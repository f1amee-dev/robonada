const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Konfiguracija bota za ankete')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option
        .setName('kanal')
        .setDescription('Kanal u kojem će se slati ankete')
        .setRequired(true))
    .addIntegerOption(option =>
      option
        .setName('dan')
        .setDescription('Dan u tjednu (1 = Ponedjeljak, 7 = Nedjelja)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(7))
    .addStringOption(option =>
      option
        .setName('vrijeme')
        .setDescription('Vrijeme slanja ankete (HH:MM, 24-h format)')
        .setRequired(true))
    .addRoleOption(option =>
      option
        .setName('role1')
        .setDescription('Prvi role koji će biti označen u anketama')
        .setRequired(false))
    .addRoleOption(option =>
      option
        .setName('role2')
        .setDescription('Drugi role koji će biti označen u anketama')
        .setRequired(false))
    .addRoleOption(option =>
      option
        .setName('role3')
        .setDescription('Treći role koji će biti označen u anketama')
        .setRequired(false)),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      // Get options
      const channel = interaction.options.getChannel('kanal');
      const day = interaction.options.getInteger('dan');
      const time = interaction.options.getString('vrijeme');
      
      // Get all roles that were provided
      const roles = [];
      for (let i = 1; i <= 3; i++) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) roles.push(role);
      }

      // Validate time format
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Greška')
          .setDescription('Nevažeći format vremena. Koristite HH:MM format (npr. 16:00)');
        
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Create config object
      const config = {
        pollChannelId: channel.id,
        pollDay: day,
        pollTime: time,
        mentionRoles: roles.map(role => role.id)
      };

      // Save configuration
      const configPath = path.join(__dirname, '..', 'pollConfig.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Create confirmation embed
      const days = ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];
      const dayName = days[day - 1];

      const confirmationEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Konfiguracija uspješno spremljena')
        .setDescription('Postavke za automatske ankete su ažurirane.')
        .addFields(
          { name: 'Kanal', value: `<#${channel.id}>`, inline: true },
          { name: 'Dan', value: dayName, inline: true },
          { name: 'Vrijeme', value: time, inline: true }
        )
        .setTimestamp();

      // Add roles field if any roles were set
      if (roles.length > 0) {
        confirmationEmbed.addFields({
          name: 'Označene uloge',
          value: roles.map(role => `<@&${role.id}>`).join('\n'),
          inline: false
        });
      } else {
        confirmationEmbed.addFields({
          name: 'Označene uloge',
          value: 'Nije postavljeno',
          inline: false
        });
      }

      await interaction.editReply({ embeds: [confirmationEmbed] });

      // Reinitialize anketa command
      const anketaCommand = interaction.client.commands.get('anketa');
      if (anketaCommand && anketaCommand.init) {
        anketaCommand.init(interaction.client);
        
        const logEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('ℹ️ Informacija')
          .setDescription('Anketa naredba je ponovno pokrenuta s novim postavkama.');
        
        console.log('[INFO] Anketa command reinitialized with new settings');
        await interaction.followUp({ embeds: [logEmbed], ephemeral: true });
      }

    } catch (error) {
      console.error('[ERROR] Greška prilikom setup procesa:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Greška')
        .setDescription('Došlo je do greške prilikom postavljanja konfiguracije. Pokušajte ponovno.')
        .addFields({
          name: 'Detalji greške',
          value: error.message || 'Nepoznata greška'
        });

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
}; 