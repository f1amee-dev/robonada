const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');
const db = require('./database');
const { handlePollButtonInteraction } = require('./commands/anketa');

// inicijalizacija bota s potrebnim intentsima
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// inicijalizacija baze podataka
db.initializeDatabase();

// pohrana aktivnih anketa
client.activePolls = new Map();

// učitavanje naredbi
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[upozorenje] naredba u ${file} nema potrebno svojstvo "data" ili "execute".`);
  }
}

// obrada slash naredbi
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`[greška] nije pronađena naredba koja odgovara ${interaction.commandName}.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[greška] greška prilikom izvršavanja ${interaction.commandName}`);
    console.error(error);
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ 
        content: 'Došlo je do greške prilikom izvršavanja naredbe.',
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: 'Došlo je do greške prilikom izvršavanja naredbe.',
        ephemeral: true 
      });
    }
  }
});

// obrada interakcija s gumbima
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const poll = client.activePolls.get(interaction.message.id);
  if (!poll) return;

  try {
    await handlePollButtonInteraction(interaction, poll, client);
  } catch (error) {
    console.error('[greška] greška prilikom obrade interakcije s gumbom:', error);
    await interaction.reply({ 
      content: 'Došlo je do greške prilikom obrade vašeg glasa.',
      ephemeral: true 
    });
  }
});

// zabilježi kada je bot spreman
client.once('ready', () => {
  console.log(`[info] prijavljen kao ${client.user.tag}`);
  
  // inicijalizacija anketa naredbe
  const anketaCommand = client.commands.get('anketa');
  if (anketaCommand && anketaCommand.init) {
    anketaCommand.init(client);
    console.log('[info] anketa naredba inicijalizirana');
  }
});

// prijava bota
client.login(config.token);