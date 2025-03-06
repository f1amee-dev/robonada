const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pomoc')
    .setDescription('Prikazuje listu dostupnih komanda'),

  async execute(interaction) {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('Pomoć - Lista komanda')
      .setDescription('Ovdje su sve dostupne komande koje možete koristiti:')
      .addFields(
        { 
          name: '📊 Ankete i Prisutnost',
          value: 
            '`/anketa info` - Informacije o automatskoj anketi\n' +
            '`/anketa test` - Stvara test anketu u trenutnom kanalu (traje 1 minutu)\n' +
            '`/anketa end` - Završava aktivnu anketu u trenutnom kanalu\n' +
            '`/statistika` - Prikazuje vašu statistiku prisutnosti'
        },
        { 
          name: '📁 Pohrana Datoteka',
          value: 
            '`/storage upload` - Učitavanje datoteke (max 10MB)\n' +
            '`/storage url` - Učitavanje datoteke s URL-a\n' +
            '`/storage download` - Preuzimanje datoteke pomoću ID-a\n' +
            '`/storage list` - Popis vaših datoteka\n' +
            '`/storage delete` - Brisanje datoteke pomoću ID-a'
        },

        {
          name: '⚙️ Postavke Bota',
          value: 
            '`/setup` - Konfiguracija bota (samo za admine)\n' +
            'Postavke koje možete konfigurirati:\n' +
            '• Kanal za automatske ankete\n' +
            '• Dan u tjednu za slanje anketa\n' +
            '• Vrijeme slanja anketa\n' +
            '• Role-ovi koji će biti označeni'
        },
        {
          name: '🎯 Funkcije Ankete',
          value: 
            '• Automatsko brisanje nakon isteka vremena\n' +
            '• Prikaz preostalog vremena\n' +
            '• Mogućnost promjene glasa\n' +
            '• Praćenje statistike dolazaka'
        },
        {
          name: '📈 Statistika',
          value: 
            '• Praćenje osobne prisutnosti\n' +
            '• Automatsko bilježenje dolazaka'
        },
        {
          name: '💾 Funkcije Pohrane',
          value: 
            '• Sigurno spremanje datoteka\n' +
            '• Enkripcija svih datoteka\n' +
            '• Preuzimanje kroz privatne poruke\n' +
            '• Pregled i brisanje vlastitih datoteka'
        }
      )
      .setFooter({ 
        text: 'Test ankete traju 1 minutu • Redovne ankete traju 1 sat\nZa dodatnu pomoć kontaktirajte filipa.' 
      });

    await interaction.reply({ embeds: [helpEmbed] });
  }
};