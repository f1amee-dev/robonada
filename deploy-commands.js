const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
// dohvaćanje svih datoteka naredbi iz direktorija commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// dohvaćanje SlashCommandBuilder#toJSON() izlaza iz podataka svake naredbe za implementaciju
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.log(`[upozorenje] naredba u ${filePath} nema potrebno svojstvo "data" ili "execute".`);
  }
}

// izrada i priprema instance REST modula
const rest = new REST().setToken(token);

// i implementacija naredbi!
(async () => {
  try {
    console.log(`započeto osvježavanje ${commands.length} aplikacijskih (/) naredbi.`);

    // put metoda se koristi za potpuno osvježavanje svih naredbi u guildu s trenutnim setom
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );

    console.log(`uspješno ponovno učitano ${data.length} aplikacijskih (/) naredbi.`);
  } catch (error) {
    console.error(error);
  }
})(); 