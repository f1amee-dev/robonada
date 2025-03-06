const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statistika')
    .setDescription('Prikazuje vašu statistiku prisutnosti'),

  async execute(interaction) {
    try {
      const stats = await db.getAttendanceStats(interaction.user.id);
      
      const statsEmbed = {
        title: '📊 Vaša statistika prisutnosti 📊',
        description: `Došli ste na robotiku **${stats.total_attendance || 0}** puta.`,
        color: parseInt('0099ff', 16),
        timestamp: new Date(),
        footer: { text: 'Statistika se ažurira automatski nakon svake robotike.' },
        fields: []
      };

      if (stats.last_attended) {
        statsEmbed.fields.push({
          name: '🕒 Zadnji put',
          value: `<t:${Math.floor(new Date(stats.last_attended).getTime() / 1000)}:D>`,
          inline: true
        });
      }

      await interaction.reply({ embeds: [statsEmbed] });
    } catch (error) {
      console.error('Greška prilikom dohvaćanja statistike:', error);
      await interaction.reply({ 
        content: 'Došlo je do greške prilikom dohvaćanja statistike.',
        ephemeral: true 
      });
    }
  }
};