const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');

const rest = new REST({ version: '10' }).setToken(token);

// pomoćna funkcija za dodavanje odgode između operacija
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function deleteCommands() {
  try {
    console.log('Starting command deletion process...');
    console.log(`Application ID: ${clientId}`);
    console.log(`Guild ID: ${guildId}`);
    
    // prvo provjeri dozvole bota
    try {
      await rest.get(Routes.applicationCommands(clientId));
    } catch (error) {
      if (error.status === 403) {
        console.error('❌ Error: Bot token does not have the applications.commands scope!');
        console.log('Please regenerate your bot token and ensure it has the proper permissions.');
        return;
      }
    }

    // dohvati postojeće naredbe s obradom pogrešaka
    console.log('\nFetching existing commands...');
    
    let guildCommands = [];
    let globalCommands = [];
    
    try {
      guildCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    } catch (error) {
      console.error('Error fetching guild commands:', error.message);
      if (error.status === 404) {
        console.log('Guild not found or bot not in guild');
      }
    }
    
    try {
      globalCommands = await rest.get(Routes.applicationCommands(clientId));
    } catch (error) {
      console.error('Error fetching global commands:', error.message);
    }

    console.log(`Found ${guildCommands.length} guild commands and ${globalCommands.length} global commands.`);

    // izbriši guild naredbe s logikom ponovnog pokušaja
    if (guildCommands.length > 0) {
      console.log('\nDeleting guild commands...');
      for (const command of guildCommands) {
        try {
          await rest.delete(Routes.applicationGuildCommand(clientId, guildId, command.id));
          console.log(`✓ Deleted guild command "${command.name}" (${command.id})`);
          await wait(1000); // čekaj 1 sekundu između brisanja
        } catch (error) {
          console.error(`Failed to delete guild command "${command.name}":`, error.message);
        }
      }
    }

    // izbriši globalne naredbe s logikom ponovnog pokušaja
    if (globalCommands.length > 0) {
      console.log('\nDeleting global commands...');
      for (const command of globalCommands) {
        try {
          await rest.delete(Routes.applicationCommand(clientId, command.id));
          console.log(`✓ Deleted global command "${command.name}" (${command.id})`);
          await wait(1000); // čekaj 1 sekundu između brisanja
        } catch (error) {
          console.error(`Failed to delete global command "${command.name}":`, error.message);
        }
      }
    }

    // prisilno očisti sve naredbe
    console.log('\nForce clearing all commands...');
    
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      console.log('✓ Cleared guild commands');
    } catch (error) {
      console.error('Error clearing guild commands:', error.message);
    }

    await wait(2000); // čekaj 2 sekunde prije sljedeće operacije

    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log('✓ Cleared global commands');
    } catch (error) {
      console.error('Error clearing global commands:', error.message);
    }

    await wait(2000); // čekaj prije završne provjere

    // završna provjera
    console.log('\nVerifying deletion...');
    
    let remainingGuildCommands = [];
    let remainingGlobalCommands = [];
    
    try {
      remainingGuildCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    } catch (error) {
      console.error('Error checking remaining guild commands:', error.message);
    }
    
    try {
      remainingGlobalCommands = await rest.get(Routes.applicationCommands(clientId));
    } catch (error) {
      console.error('Error checking remaining global commands:', error.message);
    }

    if (remainingGuildCommands.length === 0 && remainingGlobalCommands.length === 0) {
      console.log('\n✅ Successfully deleted all commands!');
      console.log('Note: It may take up to 1 hour for Discord\'s cache to fully update.');
      console.log('If commands still appear in Discord, please wait or restart your Discord client.');
    } else {
      console.log('\n⚠️ Warning: Some commands still remain:');
      if (remainingGuildCommands.length > 0) {
        console.log('Guild commands remaining:', remainingGuildCommands.map(c => c.name).join(', '));
      }
      if (remainingGlobalCommands.length > 0) {
        console.log('Global commands remaining:', remainingGlobalCommands.map(c => c.name).join(', '));
      }
    }

  } catch (error) {
    console.error('\n❌ Fatal error during command deletion:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      method: error.method,
      url: error.url
    });
  }
}

// pokreni proces brisanja
deleteCommands(); 