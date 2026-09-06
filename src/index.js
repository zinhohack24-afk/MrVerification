require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'OAUTH_REDIRECT_URI',
  'VERIFICATION_GUILD_ID',
  'VERIFICATION_CHANNEL_ID',
];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(`Variaveis ausentes no .env: ${missing.join(', ')}`);
}

const port = Number(process.env.PORT || 3000);
const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
const pendingRoleId = process.env.PENDING_ROLE_ID;
const configuredGuildIds = (process.env.JOIN_GUILD_IDS || process.env.VERIFICATION_GUILD_ID)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const pendingStates = new Map();
const authorizationFile = path.join(__dirname, '..', 'data', 'authorized-members.json');
const authorizedMembers = loadAuthorizations();
let additionInProgress = false;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function oauthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
    scope: 'identify guilds.join',
    state,
    prompt: 'consent',
  });

  return `https://discord.com/oauth2/authorize?${params}`;
}

function oauthStartUrl() {
  const callbackUrl = new URL(process.env.OAUTH_REDIRECT_URI);
  return `${callbackUrl.origin}/oauth/start`;
}

function localPage(title, message, tone = 'info') {
  const accent = tone === 'success' ? '#57f287' : tone === 'error' ? '#ed4245' : '#5865f2';
  const icon = tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i';
  const discordUrl = `https://discord.com/channels/${process.env.VERIFICATION_GUILD_ID}/${process.env.VERIFICATION_CHANNEL_ID}`;
  const backgroundImage = 'https://cdn.discordapp.com/attachments/1529764062123135048/1546221266661416990/image.png?ex=6a9efe45&is=6a9dacc5&hm=14c3a59ca623e9b35a539c285f852867593131771f534bd7c4e7923408c83aa9';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | UNLOCKED</title>
  <style>
    :root { color-scheme: dark; font-family: "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #f7f2ff; background: linear-gradient(135deg, #09020fdd, #170326cc), url('${backgroundImage}') center/cover fixed; }
    main { width: min(100%, 560px); padding: 38px; text-align: center; background: #140d1de8; border: 1px solid #b347e766; border-radius: 18px; box-shadow: 0 24px 70px #08010dcc, 0 0 50px #9d29d633; backdrop-filter: blur(10px); }
    .brand { margin-bottom: 26px; color: #f3b4ff; font-size: 13px; font-weight: 800; letter-spacing: 4px; }
    .brand strong { display: block; margin-top: 6px; color: #fff; font-size: clamp(28px, 8vw, 44px); letter-spacing: 1px; text-shadow: 0 0 22px #d65cff; }
    .icon { width: 54px; height: 54px; margin: 0 auto 20px; display: grid; place-items: center; color: #190522; background: ${accent}; border-radius: 50%; font-size: 30px; font-weight: 800; box-shadow: 0 0 28px ${accent}99; }
    h1 { margin: 0 0 12px; font-size: clamp(24px, 6vw, 34px); }
    p { margin: 0 auto 28px; max-width: 420px; color: #b5bac5; line-height: 1.6; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 22px; border: 0; border-radius: 9px; color: #fff; background: #8d35d6; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; transition: transform .2s, background .2s; }
    a:hover { background: #aa45ef; transform: translateY(-2px); }
    small { display: block; margin-top: 22px; color: #b9a4c4; }
  </style>
</head>
<body><main>
  <div class="brand">PORTAL DE PRODUTOS<strong>MRSTORE</strong></div>
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <a href="${discordUrl}">Voltar ao Discord</a>
  <small>MRSTORE • Autorização segura pelo Discord</small>
</main></body></html>`;
}

function loadAuthorizations() {
  try {
    const saved = JSON.parse(fs.readFileSync(authorizationFile, 'utf8'));
    return new Map(Object.entries(saved));
  } catch {
    return new Map();
  }
}

function saveAuthorizations() {
  fs.mkdirSync(path.dirname(authorizationFile), { recursive: true });
  fs.writeFileSync(authorizationFile, JSON.stringify(Object.fromEntries(authorizedMembers), null, 2));
}

async function refreshAccessToken(memberRecord) {
  if (!memberRecord.refreshToken) return memberRecord.accessToken;
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: memberRecord.refreshToken,
  });
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Autorizacao expirada ou revogada: ${response.status}`);
  const token = await response.json();
  memberRecord.accessToken = token.access_token;
  memberRecord.refreshToken = token.refresh_token || memberRecord.refreshToken;
  memberRecord.expiresAt = Date.now() + (token.expires_in * 1000);
  saveAuthorizations();
  return memberRecord.accessToken;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
  });
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Falha ao trocar codigo OAuth2: ${response.status}`);
  }
  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Falha ao consultar perfil: ${response.status}`);
  }
  return response.json();
}

async function addUserToGuild(guildId, userId, accessToken) {
  const response = await fetch(`https://discord.com/api/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken }),
  });

  if (![201, 204].includes(response.status)) {
    throw new Error(`Falha ao adicionar no servidor ${guildId}: ${response.status}`);
  }
}

async function completeMemberRoles(guild, userId) {
  const member = await guild.members.fetch(userId);
  if (pendingRoleId && member.roles.cache.has(pendingRoleId)) await member.roles.remove(pendingRoleId);
  if (verifiedRoleId && !member.roles.cache.has(verifiedRoleId)) await member.roles.add(verifiedRoleId);
}

async function addAuthorizedMember(memberRecord, targetGuildId) {
  const accessToken = memberRecord.expiresAt && memberRecord.expiresAt > Date.now() + 60_000
    ? memberRecord.accessToken
    : await refreshAccessToken(memberRecord);
  const targetGuildIds = [targetGuildId];
  const addedTo = [];
  const failures = [];

  for (const guildId of targetGuildIds) {
    try {
      await addUserToGuild(guildId, memberRecord.user.id, accessToken);
      const guild = await client.guilds.fetch(guildId);
      await guild.members.fetch(memberRecord.user.id);
      addedTo.push(guild.name);
    } catch (error) {
      const guild = client.guilds.cache.get(guildId);
      failures.push(`${guild?.name || guildId}: ${error.message}`);
    }
  }

  if (targetGuildId === process.env.VERIFICATION_GUILD_ID && failures.length === 0) {
    const verificationGuild = await client.guilds.fetch(process.env.VERIFICATION_GUILD_ID);
    await completeMemberRoles(verificationGuild, memberRecord.user.id);
  }
  return { addedTo, failures };
}

async function processAddition(targetCount, maxErrors, targetGuildId) {
  if (additionInProgress) throw new Error('Ja existe um processamento em andamento.');
  additionInProgress = true;
  let added = 0;
  let errors = 0;
  const addedMembers = [];
  const failures = [];

  try {
    for (const [userId, memberRecord] of authorizedMembers) {
      const processedGuilds = memberRecord.processedGuildIds || [];
      if (added >= targetCount || errors > maxErrors || processedGuilds.includes(targetGuildId)) continue;
      try {
        const result = await addAuthorizedMember(memberRecord, targetGuildId);
        if (result.addedTo.length > 0) {
          addedMembers.push({ id: userId, username: memberRecord.user.username, servers: result.addedTo });
        }
        if (result.failures.length > 0) {
          errors += result.failures.length;
          failures.push(`${memberRecord.user.username}: ${result.failures.join('; ')}`);
          if (errors > maxErrors) break;
          continue;
        }
        memberRecord.processedGuildIds = [...processedGuilds, targetGuildId];
        saveAuthorizations();
        added += 1;
      } catch (error) {
        errors += 1;
        failures.push(`${memberRecord.user.username}: ${error.message}`);
        if (errors > maxErrors) break;
      }
    }
  } finally {
    additionInProgress = false;
  }

  const remaining = [...authorizedMembers.values()].filter((member) => !(member.processedGuildIds || []).includes(targetGuildId)).length;
  return { added, errors, remaining, addedMembers, failures };
}

function availableGuildsText() {
  const guilds = [...client.guilds.cache.values()];
  return guilds.length > 0
    ? guilds.map((guild) => `• ${guild.name} (${guild.id})`).join('\n').slice(0, 1024)
    : 'Nenhum servidor detectado.';
}

function additionReportEmbed(result, targetCount) {
  const addedList = result.addedMembers.length > 0
    ? result.addedMembers.map((member) => `• ${member.username} (<@${member.id}>)\n  Servidores: ${member.servers.join(', ') || 'nenhum'}`).join('\n').slice(0, 1024)
    : 'Nenhum membro foi adicionado.';
  const failureList = result.failures.length > 0
    ? result.failures.map((failure) => `• ${failure}`).join('\n').slice(0, 1024)
    : 'Nenhuma falha registrada.';

  return new EmbedBuilder()
    .setColor(result.added === targetCount ? 0x57f287 : 0xfee75c)
    .setTitle('Relatorio de adicao')
    .setDescription(`Processamento encerrado: **${result.added}/${targetCount}** membros adicionados.`)
    .addFields(
      { name: `Adicionados (${result.added})`, value: addedList },
      { name: `Falhas (${result.errors})`, value: failureList },
      { name: 'Autorizacoes restantes', value: String(result.remaining), inline: true }
    )
    .setTimestamp();
}

function verificationEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Verificacao de acesso')
    .setDescription('Conclua a verificacao para liberar seu acesso a comunidade.')
    .setImage('https://cdn.discordapp.com/attachments/1529764062123135048/1546221266661416990/image.png?ex=6a9efe45&is=6a9dacc5&hm=14c3a59ca623e9b35a539c285f852867593131771f534bd7c4e7923408c83aa9')
    .addFields(
      { name: 'Como funciona', value: '1. Clique em **Verificar com Discord**.\n2. Autorize na pagina oficial do Discord.\n3. Volte ao servidor com seu acesso liberado.' },
      { name: 'O que sera autorizado', value: 'Nome e avatar do seu perfil, alem da entrada nos servidores configurados pela comunidade.' },
      { name: 'Seguranca', value: 'A autorizacao acontece somente no Discord. Nunca informe sua senha ou compartilhe tokens.' }
    )
    .setFooter({ text: 'UNLOCKED • Verificacao segura' })
    .setTimestamp();
}

function verificationRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setURL(oauthStartUrl())
      .setLabel('Verificar com Discord')
      .setStyle(ButtonStyle.Link)
  );
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Conectado como ${readyClient.user.tag}`);
  try {
    const channel = await readyClient.channels.fetch(process.env.VERIFICATION_CHANNEL_ID);
    if (!channel?.isTextBased()) {
      console.error('VERIFICATION_CHANNEL_ID nao aponta para um canal de texto.');
      return;
    }
    await channel.send({ embeds: [verificationEmbed()], components: [verificationRow()] });
  } catch (error) {
    console.error(
      'Nao foi possivel acessar o canal de verificacao. Confirme o ID, convide o bot ao servidor e permita Ver canal e Enviar mensagens.',
      error.code || error.message
    );
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || message.content.trim().toLowerCase() !== '!painel-adicionar') return;
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    await message.reply('Voce precisa da permissao **Gerenciar servidor** para abrir este painel.');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Painel de adicao')
    .setDescription('Processe somente membros que autorizaram o Discord. Defina a quantidade e o limite de falhas permitidas.')
    .addFields(
      { name: 'Autorizacoes aguardando neste servidor', value: String([...authorizedMembers.values()].filter((member) => !(member.processedGuildIds || []).includes(message.guild.id)).length), inline: true },
      { name: 'Servidores detectados', value: availableGuildsText() }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_addition_panel').setLabel('Configurar adicao').setStyle(ButtonStyle.Primary)
  );
  await message.reply({ embeds: [embed], components: [row] });
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== process.env.VERIFICATION_GUILD_ID) return;
  try {
    await member.send('Bem-vindo! Acesse o canal de verificacao do servidor para concluir sua entrada.');
  } catch {
    // Mensagens diretas podem estar bloqueadas; a mensagem publica continua disponivel.
  }
});

const app = express();
app.get('/health', (request, response) => {
  response.json({ status: 'ok', service: 'mrstore-verification-bot' });
});

app.get('/', (request, response) => {
  response.send(localPage('Verificação UNLOCKED', 'Esta página é usada para concluir a autorização do Discord. Volte ao servidor e clique no botão de verificação.', 'info'));
});

app.get('/oauth/start', (request, response) => {
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { createdAt: Date.now() });
  response.redirect(oauthUrl(state));
});

app.get('/oauth/callback', async (request, response) => {
  const { code, state, error } = request.query;
  const pending = pendingStates.get(state);
  pendingStates.delete(state);

  if (error || !pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    return response.status(400).send(localPage('Autorização expirada', 'A autorização foi cancelada ou demorou demais. Volte ao Discord e tente novamente.', 'error'));
  }

  try {
    const token = await exchangeCode(code);
    const user = await fetchDiscordUser(token.access_token);
    const previous = authorizedMembers.get(user.id);
    authorizedMembers.set(user.id, {
      user,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in * 1000),
      createdAt: previous?.createdAt || Date.now(),
      processedAt: previous?.processedAt || null,
    });
    saveAuthorizations();
    return response.send(localPage('Bem-vindo à MRSTORE', 'Seu acesso está pronto. Explore nosso catálogo de produtos digitais, keys de jogos e serviços exclusivos com entrega rápida.', 'success'));
  } catch (error) {
    console.error(error);
    return response.status(500).send(localPage('Não foi possível concluir', 'Ocorreu um erro ao registrar a autorização. Volte ao Discord e tente novamente.', 'error'));
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'open_addition_panel') {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Voce precisa da permissao **Gerenciar servidor** para usar este painel.', ephemeral: true });
    }
    const modal = new ModalBuilder().setCustomId(`addition_settings:${interaction.guildId}`).setTitle('Adicionar membros');
    const quantity = new TextInputBuilder().setCustomId('quantity').setLabel('Quantidade de membros').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex.: 10');
    const maxErrors = new TextInputBuilder().setCustomId('max_errors').setLabel('Falhas permitidas').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex.: 2');
    modal.addComponents(new ActionRowBuilder().addComponents(quantity), new ActionRowBuilder().addComponents(maxErrors));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('addition_settings:')) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Voce precisa da permissao **Gerenciar servidor** para iniciar uma adicao.', ephemeral: true });
    }
    const targetCount = Number.parseInt(interaction.fields.getTextInputValue('quantity'), 10);
    const maxErrors = Number.parseInt(interaction.fields.getTextInputValue('max_errors'), 10);
    const targetGuildId = interaction.customId.split(':')[1];
    if (!Number.isInteger(targetCount) || targetCount < 1 || !Number.isInteger(maxErrors) || maxErrors < 0) {
      return interaction.reply({ content: 'Informe uma quantidade maior que zero e falhas permitidas a partir de zero.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await processAddition(targetCount, maxErrors, targetGuildId);
      await interaction.editReply('Processamento concluido. O relatorio foi publicado neste canal.');
      return interaction.channel.send({ embeds: [additionReportEmbed(result, targetCount)] });
    } catch (error) {
      return interaction.editReply(`Nao foi possivel iniciar: ${error.message}`);
    }
  }
});

const server = app.listen(port, '0.0.0.0', () => console.log(`OAuth2 ouvindo na porta ${port}`));

async function shutdown(signal) {
  console.log(`${signal}: encerrando servicos`);
  server.close();
  await client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
client.login(process.env.DISCORD_TOKEN);