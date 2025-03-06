const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { pipeline } = require('stream/promises');
const { createWriteStream, createReadStream } = require('fs');
const config = require('../config.json');

// funkcije za enkripciju
function encryptFile(buffer, key) {
  // osiguravanje da je ključ točno 32 bajta (256 bita) za AES-256-CBC
  const hash = crypto.createHash('sha256').update(String(key)).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', hash, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function decryptFile(buffer, key) {
  // osiguravanje da je ključ točno 32 bajta (256 bita) za AES-256-CBC
  const hash = crypto.createHash('sha256').update(String(key)).digest();
  const iv = buffer.slice(0, 16);
  const encryptedData = buffer.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', hash, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

// funkcija za dijeljenje datoteke na dijelove
async function splitFileIntoChunks(buffer, maxChunkSize = 8 * 1024 * 1024) {
  const chunks = [];
  let offset = 0;
  
  while (offset < buffer.length) {
    const chunkSize = Math.min(maxChunkSize, buffer.length - offset);
    const chunk = buffer.slice(offset, offset + chunkSize);
    chunks.push(chunk);
    offset += chunkSize;
  }
  
  return chunks;
}

// funkcija za preuzimanje datoteke s filebin.net koristeći node-fetch
async function downloadFromFilebin(url) {
  const fetch = require('node-fetch');
  console.log('[info] korištenje node-fetch za filebin.net preuzimanje');
  
  try {
    const options = {
      method: 'GET',
      headers: {
        cookie: 'verified=2024-05-24',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Referer: 'https://filebin.net/',
        Connection: 'keep-alive',
        Cookie: 'verified=2024-05-24',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        Priority: 'u=0, i'
      }
    };
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    // dohvaćanje imena datoteke iz URL-a
    let filename = url.split('/').pop().split('?')[0] || 'downloaded_file';
    
    // pokušaj dohvaćanja imena datoteke iz content-disposition zaglavlja ako je dostupno
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }
    
    // dohvaćanje tipa sadržaja
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    // dohvaćanje buffera
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[info] preuzeta datoteka s filebin.net koristeći node-fetch, veličina: ${buffer.length} bajtova`);
    
    return {
      buffer,
      filename,
      contentType
    };
  } catch (error) {
    console.error('[greška] neuspjelo preuzimanje s filebin koristeći node-fetch:', error);
    throw error;
  }
}

// funkcija za preuzimanje datoteke s url-a
async function downloadFileFromUrl(url) {
  try {
    // provjera je li to filebin.net url
    const isFilebin = url.includes('filebin.net');
    
    // za filebin url-ove, trebamo posebno rukovanje
    if (isFilebin) {
      try {
        // prvo pokušaj s node-fetch
        return await downloadFromFilebin(url);
      } catch (filebinError) {
        console.error('[greška] neuspjelo s node-fetch, prebacivanje na axios:', filebinError);
        
        // prebacivanje na axios ako node-fetch ne uspije
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'arraybuffer',
          maxRedirects: 5,
          headers: {
            'cookie': 'verified=2024-05-24',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Referer': 'https://filebin.net/',
            'Connection': 'keep-alive',
            'Cookie': 'verified=2024-05-24',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Priority': 'u=0, i'
          },
          validateStatus: status => status < 400
        });
        
        // izvlačenje imena datoteke iz url-a
        let filename = url.split('/').pop().split('?')[0] || 'downloaded_file';
        
        // pokušaj dohvaćanja imena datoteke iz content-disposition zaglavlja ako je dostupno
        const contentDisposition = response.headers['content-disposition'];
        if (contentDisposition) {
          const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
          if (filenameMatch && filenameMatch[1]) {
            filename = filenameMatch[1].replace(/['"]/g, '');
          }
        }
        
        console.log(`[info] preuzeta datoteka s filebin.net koristeći axios rezervu, veličina: ${response.data.length} bajtova`);
        
        return {
          buffer: Buffer.from(response.data),
          filename: filename,
          contentType: response.headers['content-type'] || 'application/octet-stream'
        };
      }
    } else {
      // standardno rukovanje url-om
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        maxRedirects: 5,
        validateStatus: status => status < 400
      });
      
      // pokušaj dohvaćanja imena datoteke iz content-disposition zaglavlja
      let filename = url.split('/').pop().split('?')[0] || 'downloaded_file';
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      
      console.log(`[info] preuzeta datoteka s url-a, veličina: ${response.data.length} bajtova`);
      
      return {
        buffer: Buffer.from(response.data),
        filename: filename,
        contentType: response.headers['content-type'] || 'application/octet-stream'
      };
    }
  } catch (error) {
    console.error('[greška] neuspjelo preuzimanje datoteke:', error);
    throw new Error(`Failed to download file from URL: ${error.message}`);
  }
}

// funkcija za pohranu metapodataka datoteke u discord kanalu
async function storeFileMetadata(interaction, filename, userId, username, chunks, originalSize, contentType, messageIds) {
  try {
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      throw new Error('Storage channel not found');
    }
    
    // stvaranje objekta metapodataka
    const metadata = {
      id: Date.now().toString(), // korištenje vremenske oznake kao id
      filename: filename,
      user_id: userId,
      username: username,
      chunks: chunks,
      original_size: originalSize,
      content_type: contentType,
      message_ids: messageIds,
      upload_date: new Date().toISOString()
    };
    
    // pohrana metapodataka u kanalu
    const metadataMessage = await storageChannel.send({
      content: `METADATA:${Buffer.from(JSON.stringify(metadata)).toString('base64')}`
    });
    
    return metadata.id;
  } catch (error) {
    console.error('[greška] neuspjela pohrana metapodataka datoteke:', error);
    throw error;
  }
}

// funkcija za dohvaćanje metapodataka datoteke
async function getFileMetadata(interaction, fileId) {
  try {
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      throw new Error('Storage channel not found');
    }
    
    // dohvaćanje poruka iz kanala
    const messages = await storageChannel.messages.fetch({ limit: 100 });
    
    // pronalaženje poruke s metapodacima
    for (const message of messages.values()) {
      if (message.content.startsWith('METADATA:')) {
        try {
          const metadataBase64 = message.content.substring(9);
          const metadata = JSON.parse(Buffer.from(metadataBase64, 'base64').toString());
          
          if (metadata.id === fileId) {
            return metadata;
          }
        } catch (e) {
          console.error('[greška] neuspjelo parsiranje metapodataka:', e);
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[greška] neuspjelo dohvaćanje metapodataka datoteke:', error);
    throw error;
  }
}

// funkcija za dohvaćanje korisnikovih datoteka
async function getUserFiles(interaction, userId) {
  try {
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      throw new Error('Storage channel not found');
    }
    
    // dohvaćanje poruka iz kanala
    const messages = await storageChannel.messages.fetch({ limit: 100 });
    
    // pronalaženje poruka s metapodacima za korisnika
    const files = [];
    
    for (const message of messages.values()) {
      if (message.content.startsWith('METADATA:')) {
        try {
          const metadataBase64 = message.content.substring(9);
          const metadata = JSON.parse(Buffer.from(metadataBase64, 'base64').toString());
          
          if (metadata.user_id === userId) {
            files.push({
              id: metadata.id,
              filename: metadata.filename,
              chunks: metadata.chunks,
              original_size: metadata.original_size,
              upload_date: metadata.upload_date,
              message_id: message.id
            });
          }
        } catch (e) {
          console.error('[greška] neuspjelo parsiranje metapodataka:', e);
        }
      }
    }
    
    return files;
  } catch (error) {
    console.error('[greška] neuspjelo dohvaćanje korisnikovih datoteka:', error);
    throw error;
  }
}

// funkcija za brisanje datoteke
async function deleteFile(interaction, fileId) {
  try {
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      throw new Error('Storage channel not found');
    }
    
    // dohvaćanje poruka iz kanala
    const messages = await storageChannel.messages.fetch({ limit: 100 });
    
    // pronalaženje poruke s metapodacima
    let metadataMessage = null;
    let metadata = null;
    
    for (const message of messages.values()) {
      if (message.content.startsWith('METADATA:')) {
        try {
          const metadataBase64 = message.content.substring(9);
          const parsedMetadata = JSON.parse(Buffer.from(metadataBase64, 'base64').toString());
          
          if (parsedMetadata.id === fileId) {
            metadataMessage = message;
            metadata = parsedMetadata;
            break;
          }
        } catch (e) {
          console.error('[greška] neuspjelo parsiranje metapodataka:', e);
        }
      }
    }
    
    if (!metadataMessage || !metadata) {
      return false;
    }
    
    // brisanje poruka datoteke
    for (const messageId of metadata.message_ids) {
      try {
        const message = await storageChannel.messages.fetch(messageId);
        if (message) {
          await message.delete();
        }
      } catch (e) {
        console.error(`[greška] neuspjelo brisanje poruke ${messageId}:`, e);
      }
    }
    
    // brisanje poruke s metapodacima
    await metadataMessage.delete();
    
    return true;
  } catch (error) {
    console.error('[greška] neuspjelo brisanje datoteke:', error);
    throw error;
  }
}

// funkcija za učitavanje datoteke na filebin.net
async function uploadToFilebin(buffer, filename) {
  const fetch = require('node-fetch');
  const FormData = require('form-data');
  
  try {
    // generiranje nasumičnog bin ID-a ako nije naveden
    const binId = Math.random().toString(36).substring(2, 15);
    
    console.log(`[INFO] Uploading file to filebin.net with bin ID: ${binId}`);
    
    // stvaranje form data
    const form = new FormData();
    form.append('file', buffer, {
      filename: filename,
      contentType: 'application/octet-stream'
    });
    
    // učitavanje na filebin.net
    const response = await fetch(`https://filebin.net/${binId}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Referer': 'https://filebin.net/',
        'Origin': 'https://filebin.net',
        'Connection': 'keep-alive',
        'Cookie': 'verified=2024-05-24',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Size': buffer.length.toString(),
        'Bin': binId,
      },
      body: form
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    console.log(`[INFO] File uploaded to filebin.net successfully, bin ID: ${binId}`);
    
    return {
      binId,
      url: `https://filebin.net/${binId}/${filename}`
    };
  } catch (error) {
    console.error('[greška] Failed to upload to filebin:', error);
    throw error;
  }
}

// funkcija za obradu preuzimanja velike datoteke putem filebin.net
async function handleLargeFileDownload(interaction, fileMetadata) {
  try {
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      throw new Error('Storage channel not found');
    }
    
    // obavještavanje korisnika da obrađujemo njihov zahtjev
    await interaction.followUp({
      content: 'Obrađujem vašu datoteku, ovo može potrajati nekoliko trenutaka...',
      ephemeral: true
    });
    
    // stvaranje buffera za držanje svih dijelova
    let combinedBuffer = Buffer.alloc(0);
    
    // dohvaćanje i dekriptiranje svakog dijela
    for (let i = 0; i < fileMetadata.chunks; i++) {
      try {
        // pružanje ažuriranja napretka za velike datoteke
        if (fileMetadata.chunks > 1) {
          await interaction.followUp({
            content: `Preuzimanje dijela ${i+1}/${fileMetadata.chunks}...`,
            ephemeral: true
          });
        }
        
        // preuzimanje kriptiranog dijela
        const message = await storageChannel.messages.fetch(fileMetadata.message_ids[i]);
        if (!message) {
          throw new Error(`Dio ${i+1} nije pronađen.`);
        }
        
        // dekriptiranje dijela
        const encryptedChunk = Buffer.from(message.attachments.first().url);
        
        // Decrypt the chunk
        const decryptedChunk = decryptFile(encryptedChunk, config.encryptionKey);
        
        combinedBuffer = Buffer.concat([combinedBuffer, decryptedChunk]);
      } catch (error) {
        console.error(`[ERROR] Failed to download chunk ${i+1}:`, error);
        return interaction.followUp({ 
          content: `Došlo je do greške prilikom preuzimanja dijela datoteke (${i+1}/${fileMetadata.chunks}).`,
          ephemeral: true 
        });
      }
    }
    
    // Upload to filebin.net
    const { binId, url } = await uploadToFilebin(combinedBuffer, fileMetadata.filename);
    
    // Send success message with download link
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('Datoteka spremna za preuzimanje')
      .setDescription(`Vaša datoteka **${fileMetadata.filename}** je dostupna na filebin.net.`)
      .addFields(
        { name: 'Veličina', value: `${(combinedBuffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true },
        { name: 'Bin ID', value: binId, inline: true },
        { name: 'Link za preuzimanje', value: url }
      )
      .setFooter({ text: 'Link je dostupan 7 dana' });
    
    await interaction.followUp({ embeds: [embed], ephemeral: true });
    
    return true;
  } catch (error) {
    console.error('[greška] Failed to handle large file download:', error);
    throw error;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('storage')
    .setDescription('Upravljanje datotekama')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand(subcommand =>
      subcommand
        .setName('upload')
        .setDescription('Učitaj novu datoteku (max 10MB)')
        .addAttachmentOption(option => 
          option
            .setName('file')
            .setDescription('Datoteka za učitavanje')
            .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('uploadurl')
        .setDescription('Učitaj datoteku s URL-a')
        .addStringOption(option => 
          option
            .setName('url')
            .setDescription('URL datoteke za preuzimanje')
            .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('download')
        .setDescription('Preuzmi datoteku')
        .addStringOption(option => 
          option
            .setName('id')
            .setDescription('ID datoteke za preuzimanje')
            .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Prikaži listu vaših datoteka')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Izbriši datoteku')
        .addStringOption(option => 
          option
            .setName('id')
            .setDescription('ID datoteke za brisanje')
            .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setstorage')
        .setDescription('Postavi kanal za pohranu (samo za admine)')
        .addChannelOption(option => 
          option
            .setName('channel')
            .setDescription('Kanal za pohranu datoteka')
            .setRequired(true))
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    try {
      // za naredbe osim setstorage, provjeri je li kanal za pohranu postavljen
      if (subcommand !== 'setstorage') {
        // provjeri je li kanal za pohranu postavljen
        if (!config.storageChannelId) {
          return interaction.reply({ 
            content: 'Kanal za pohranu nije postavljen. Administrator mora postaviti kanal za pohranu pomoću `/storage setstorage`.',
            ephemeral: true 
          });
        }
        
        try {
          // provjeri postoji li kanal i je li dostupan
          const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
          if (!storageChannel) {
            return interaction.reply({ 
              content: 'Kanal za pohranu nije dostupan. Administrator mora postaviti kanal za pohranu pomoću `/storage setstorage`.',
              ephemeral: true 
            });
          }
        } catch (error) {
          console.error('[greška] neuspjelo dohvaćanje kanala za pohranu:', error);
          return interaction.reply({ 
            content: 'Kanal za pohranu nije dostupan. Administrator mora postaviti kanal za pohranu pomoću `/storage setstorage`.',
            ephemeral: true 
          });
        }
      }
      
      switch (subcommand) {
        case 'upload':
          await handleUpload(interaction);
          break;
        case 'uploadurl':
          await handleUploadUrl(interaction);
          break;
        case 'download':
          await handleDownload(interaction);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'delete':
          await handleDelete(interaction);
          break;
        case 'setstorage':
          await handleSetStorage(interaction);
          break;
      }
    } catch (error) {
      console.error(`[greška] greška prilikom izvršavanja storage ${subcommand}:`, error);
      
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
  }
};

// obrada učitavanja datoteke
async function handleUpload(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const attachment = interaction.options.getAttachment('file');
  
  // provjera veličine datoteke (max 10MB)
  if (attachment.size > 10 * 1024 * 1024) {
    return interaction.followUp({ 
      content: 'Datoteka je prevelika. Maksimalna veličina je 10MB.',
      ephemeral: true 
    });
  }
  
  try {
    // preuzimanje datoteke
    const response = await axios({
      method: 'GET',
      url: attachment.url,
      responseType: 'arraybuffer'
    });
    
    const fileBuffer = Buffer.from(response.data);
    
    // enkripcija datoteke
    const encryptedBuffer = encryptFile(fileBuffer, config.encryptionKey);
    
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      return interaction.followUp({ 
        content: 'Kanal za pohranu nije postavljen. Kontaktirajte administratora.',
        ephemeral: true 
      });
    }
    
    // učitavanje u kanal za pohranu
    const fileAttachment = new AttachmentBuilder(encryptedBuffer, { name: `${attachment.name}.encrypted` });
    const message = await storageChannel.send({ files: [fileAttachment] });
    
    // pohrana metapodataka
    const fileId = await storeFileMetadata(
      interaction,
      attachment.name,
      interaction.user.id,
      interaction.user.username,
      1, // samo jedan dio
      fileBuffer.length,
      attachment.contentType,
      [message.id]
    );
    
    // slanje poruke o uspjehu
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('Datoteka uspješno učitana')
      .setDescription(`Vaša datoteka **${attachment.name}** je uspješno učitana i enkriptirana.`)
      .addFields(
        { name: 'ID datoteke', value: `${fileId}`, inline: true },
        { name: 'Veličina', value: `${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true }
      )
      .setFooter({ text: 'Koristite /storage download za preuzimanje' });
    
    await interaction.followUp({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('[greška] neuspjelo učitavanje datoteke:', error);
    await interaction.followUp({ 
      content: 'Došlo je do greške prilikom učitavanja datoteke.',
      ephemeral: true 
    });
  }
}

// obrada učitavanja s url-a
async function handleUploadUrl(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const url = interaction.options.getString('url');
  
  // pružanje početne povratne informacije
  await interaction.followUp({ 
    content: `Preuzimam datoteku s URL-a: ${url}...`,
    ephemeral: true 
  });
  
  try {
    // preuzimanje datoteke s url-a
    const { buffer, filename, contentType } = await downloadFileFromUrl(url);
    
    // pružanje povratne informacije o preuzimanju
    await interaction.followUp({ 
      content: `Datoteka preuzeta: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Enkriptiram i spremam...`,
      ephemeral: true 
    });
    
    // provjera veličine datoteke
    if (buffer.length > 10 * 1024 * 1024) {
      // datoteka je prevelika, podijeli na dijelove
      const chunks = await splitFileIntoChunks(buffer);
      
      // dohvaćanje kanala za pohranu
      const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
      if (!storageChannel) {
        return interaction.followUp({ 
          content: 'Kanal za pohranu nije postavljen. Kontaktirajte administratora.',
          ephemeral: true 
        });
      }
      
      // učitavanje dijelova
      const messageIds = [];
      for (let i = 0; i < chunks.length; i++) {
        // pružanje ažuriranja napretka
        if (i === 0 || i === chunks.length - 1 || i % 5 === 0) {
          await interaction.followUp({ 
            content: `Učitavam dio ${i+1}/${chunks.length}...`,
            ephemeral: true 
          });
        }
        
        // enkripcija dijela
        const encryptedChunk = encryptFile(chunks[i], config.encryptionKey);
        
        // učitavanje dijela
        const chunkAttachment = new AttachmentBuilder(encryptedChunk, { name: `${filename}.part${i+1}.encrypted` });
        const message = await storageChannel.send({ files: [chunkAttachment] });
        messageIds.push(message.id);
      }
      
      // pohrana metapodataka
      const fileId = await storeFileMetadata(
        interaction,
        filename,
        interaction.user.id,
        interaction.user.username,
        chunks.length,
        buffer.length,
        contentType,
        messageIds
      );
      
      // slanje poruke o uspjehu
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Datoteka uspješno učitana')
        .setDescription(`Vaša datoteka **${filename}** je uspješno učitana i enkriptirana.`)
        .addFields(
          { name: 'ID datoteke', value: `${fileId}`, inline: true },
          { name: 'Veličina', value: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true },
          { name: 'Broj dijelova', value: `${chunks.length}`, inline: true }
        )
        .setFooter({ text: 'Koristite /storage download za preuzimanje' });
      
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      // datoteka je dovoljno mala, učitaj direktno
      const encryptedBuffer = encryptFile(buffer, config.encryptionKey);
      
      // dohvaćanje kanala za pohranu
      const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
      if (!storageChannel) {
        return interaction.followUp({ 
          content: 'Kanal za pohranu nije postavljen. Kontaktirajte administratora.',
          ephemeral: true 
        });
      }
      
      // učitavanje u kanal za pohranu
      const fileAttachment = new AttachmentBuilder(encryptedBuffer, { name: `${filename}.encrypted` });
      const message = await storageChannel.send({ files: [fileAttachment] });
      
      // pohrana metapodataka
      const fileId = await storeFileMetadata(
        interaction,
        filename,
        interaction.user.id,
        interaction.user.username,
        1, // samo jedan dio
        buffer.length,
        contentType,
        [message.id]
      );
      
      // slanje poruke o uspjehu
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Datoteka uspješno učitana')
        .setDescription(`Vaša datoteka **${filename}** je uspješno učitana i enkriptirana.`)
        .addFields(
          { name: 'ID datoteke', value: `${fileId}`, inline: true },
          { name: 'Veličina', value: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true }
        )
        .setFooter({ text: 'Koristite /storage download za preuzimanje' });
      
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error('[greška] neuspjelo učitavanje datoteke s URL-a:', error);
    await interaction.followUp({ 
      content: `Došlo je do greške prilikom preuzimanja datoteke s URL-a: ${error.message}`,
      ephemeral: true 
    });
  }
}

// obrada preuzimanja datoteke
async function handleDownload(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const fileId = interaction.options.getString('id');
  
  try {
    // dohvaćanje metapodataka datoteke
    const fileMetadata = await getFileMetadata(interaction, fileId);
    
    if (!fileMetadata) {
      return interaction.followUp({ 
        content: 'Datoteka nije pronađena.',
        ephemeral: true 
      });
    }
    
    // provjera je li korisnik vlasnik datoteke
    if (fileMetadata.user_id !== interaction.user.id) {
      return interaction.followUp({ 
        content: 'Nemate pristup ovoj datoteci.',
        ephemeral: true 
      });
    }
    
    // dohvaćanje kanala za pohranu
    const storageChannel = await interaction.client.channels.fetch(config.storageChannelId);
    if (!storageChannel) {
      return interaction.followUp({ 
        content: 'Kanal za pohranu nije postavljen. Kontaktirajte administratora.',
        ephemeral: true 
      });
    }
    
    // obavještavanje korisnika da obrađujemo njihov zahtjev
    await interaction.followUp({ 
      content: 'Pripremam vašu datoteku za preuzimanje...',
      ephemeral: true 
    });
    
    // ako datoteka ima više dijelova ili je veća od 8MB, koristi filebin.net
    if (fileMetadata.chunks > 1 || fileMetadata.original_size > 8 * 1024 * 1024) {
      return await handleLargeFileDownload(interaction, fileMetadata);
    } else if (fileMetadata.message_ids && fileMetadata.message_ids.length > 0) {
      // datoteka s jednim dijelom, dovoljno mala za direktni DM
      try {
        const message = await storageChannel.messages.fetch(fileMetadata.message_ids[0]);
        
        if (!message || message.attachments.size === 0) {
          return interaction.followUp({ 
            content: 'Datoteka nije pronađena u kanalu za pohranu.',
            ephemeral: true 
          });
        }
        
        // preuzimanje enkriptirane datoteke
        const attachment = message.attachments.first();
        const response = await axios({
          method: 'GET',
          url: attachment.url,
          responseType: 'arraybuffer'
        });
        
        const encryptedBuffer = Buffer.from(response.data);
        
        // dekripcija datoteke
        const decryptedBuffer = decryptFile(encryptedBuffer, config.encryptionKey);
        
        // slanje dekriptirane datoteke korisniku
        const fileAttachment = new AttachmentBuilder(decryptedBuffer, { 
          name: fileMetadata.filename,
          description: 'Decrypted file'
        });
        
        await interaction.user.send({ 
          content: `Evo vaše datoteke **${fileMetadata.filename}**:`,
          files: [fileAttachment] 
        });
        
        await interaction.followUp({ 
          content: 'Datoteka je poslana u vaše privatne poruke.',
          ephemeral: true 
        });
      } catch (error) {
        console.error('[greška] neuspjelo preuzimanje datoteke:', error);
        
        // ako je datoteka prevelika za DM, pokušaj s filebin
        if (error.code === 40005) { // Discord error code for file too large
          await interaction.followUp({ 
            content: 'Datoteka je prevelika za slanje putem privatnih poruka. Pokušavam s filebin.net...',
            ephemeral: true 
          });
          return await handleLargeFileDownload(interaction, fileMetadata);
        } else {
          await interaction.followUp({ 
            content: 'Došlo je do greške prilikom preuzimanja datoteke.',
            ephemeral: true 
          });
        }
      }
    } else {
      await interaction.followUp({ 
        content: 'Datoteka nije pronađena u kanalu za pohranu.',
        ephemeral: true 
      });
    }
  } catch (error) {
    console.error('[greška] neuspjelo preuzimanje datoteke:', error);
    await interaction.followUp({ 
      content: 'Došlo je do greške prilikom preuzimanja datoteke.',
      ephemeral: true 
    });
  }
}

// obrada liste datoteka
async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // dohvaćanje korisnikovih datoteka
    const files = await getUserFiles(interaction, interaction.user.id);
    
    if (files.length === 0) {
      return interaction.followUp({ 
        content: 'Nemate učitanih datoteka.',
        ephemeral: true 
      });
    }
    
    // stvaranje embeda s listom datoteka
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('Vaše datoteke')
      .setDescription('Ovdje su sve vaše učitane datoteke:');
    
    // dodavanje polja za svaku datoteku
    files.forEach(file => {
      embed.addFields({
        name: `ID: ${file.id} - ${file.filename}`,
        value: `Veličina: ${(file.original_size / 1024 / 1024).toFixed(2)} MB | Učitano: ${new Date(file.upload_date).toLocaleDateString()}`
      });
    });
    
    embed.setFooter({ 
      text: 'Koristite /storage download za preuzimanje ili /storage delete za brisanje' 
    });
    
    await interaction.followUp({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('[greška] neuspjelo listanje datoteka:', error);
    await interaction.followUp({ 
      content: 'Došlo je do greške prilikom dohvaćanja liste datoteka.',
      ephemeral: true 
    });
  }
}

// obrada brisanja datoteke
async function handleDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const fileId = interaction.options.getString('id');
  
  try {
    // dohvaćanje metapodataka datoteke
    const fileMetadata = await getFileMetadata(interaction, fileId);
    
    if (!fileMetadata) {
      return interaction.followUp({ 
        content: 'Datoteka nije pronađena.',
        ephemeral: true 
      });
    }
    
    // provjera je li korisnik vlasnik datoteke
    if (fileMetadata.user_id !== interaction.user.id) {
      return interaction.followUp({ 
        content: 'Nemate pristup ovoj datoteci.',
        ephemeral: true 
      });
    }
    
    // brisanje datoteke iz pohrane
    const deleted = await deleteFile(interaction, fileId);
    
    if (deleted) {
      await interaction.followUp({ 
        content: `Datoteka **${fileMetadata.filename}** je uspješno izbrisana.`,
        ephemeral: true 
      });
    } else {
      await interaction.followUp({ 
        content: 'Došlo je do greške prilikom brisanja datoteke.',
        ephemeral: true 
      });
    }
  } catch (error) {
    console.error('[greška] neuspjelo brisanje datoteke:', error);
    await interaction.followUp({ 
      content: 'Došlo je do greške prilikom brisanja datoteke.',
      ephemeral: true 
    });
  }
}

// obrada postavljanja kanala za pohranu
async function handleSetStorage(interaction) {
  // provjera ima li korisnik administratorske dozvole
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ 
      content: 'Nemate dozvolu za korištenje ove naredbe. Potrebna je administratorska dozvola.',
      ephemeral: true 
    });
  }
  
  const channel = interaction.options.getChannel('channel');
  
  // provjera je li kanal tekstualni kanal
  if (channel.type !== 0) { // 0 is GUILD_TEXT
    return interaction.reply({ 
      content: 'Odabrani kanal mora biti tekstualni kanal.',
      ephemeral: true 
    });
  }
  
  try {
    // ažuriranje konfiguracije
    config.storageChannelId = channel.id;
    
    // spremanje konfiguracije
    fs.writeFileSync(
      path.join(__dirname, '../config.json'),
      JSON.stringify(config, null, 2)
    );
    
    await interaction.reply({ 
      content: `Kanal za pohranu je postavljen na ${channel}.`,
      ephemeral: true 
    });
  } catch (error) {
    console.error('[greška] neuspjelo postavljanje kanala za pohranu:', error);
    await interaction.reply({ 
      content: 'Došlo je do greške prilikom postavljanja kanala za pohranu.',
      ephemeral: true 
    });
  }
} 