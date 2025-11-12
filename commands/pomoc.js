const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pomoc')
    .setDescription('Prikazuje listu dostupnih komanda'),

  async execute(interaction) {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('Pomoć')
      .setDescription('Najvažnije komande na jednom mjestu:')
      .addFields(
        {
          name: 'Ankete i prisutnost',
          value: [
            '`/anketa info` - kratke upute o automatskoj anketi',
            '`/anketa test` - stvara test anketu u trenutnom kanalu (1 min)',
            '`/anketa end` - ručno zatvara aktivnu anketu',
            '`/statistika prikaz` - prikazuje tvoju statistiku dolazaka'
          ].join('\n')
        },
        {
          name: 'Postavke bota',
          value: '`/setup` - vodič za kanal, dan, vrijeme i označene role'
        },
        {
          name: 'Napomene',
          value: [
            'Test ankete traju 1 minutu.',
            'Redovne ankete traju 1 sat i pauziraju se dok radionica traje.'
          ].join('\n')
        }
      )
      .setFooter({ 
        text: 'Za dodatnu pomoć kontaktirajte Filipa.' 
      });

    await interaction.reply({ embeds: [helpEmbed] });
  }
};
