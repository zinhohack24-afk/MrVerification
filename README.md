# Bot de recepcao do Discord

Bot com mensagem de boas-vindas, botao de verificacao e OAuth2 do Discord.

## Configuracao

1. Instale Node.js 20 ou mais recente.
2. No [Discord Developer Portal](https://discord.com/developers/applications), crie uma aplicacao, adicione um bot e copie o token, client ID e client secret.
3. Ative o intent `Server Members Intent` e convide o bot para todos os servidores que ele devera gerenciar.
4. Copie `.env.example` para `.env` e preencha os IDs. Os cargos `CARGO_OWNER`, `CARGO_BOTS`, `CARGO_ACEITAR_COMPRA`, `CARGO_LOJA`, `CARGO_ADMIN`, `CARGO_MOD` e `CARGO_SUPORTE` são administrativos e nunca são atribuídos pelo fluxo de verificação. O `VERIFIED_ROLE_ID` é opcional para um cargo comum de membro verificado. O `OAUTH_REDIRECT_URI` precisa estar cadastrado em OAuth2 > General.
5. Instale e inicie:

```bash
npm install
npm start
```

O bot publica uma mensagem nova no `VERIFICATION_CHANNEL_ID` ao iniciar. Para evitar mensagens duplicadas, remova as antigas antes de reiniciar ou adapte o código para localizar uma mensagem existente.

## Permissoes e consentimento

O OAuth2 usa somente os escopos `identify` e `guilds.join`: o primeiro permite obter nome e avatar; o segundo permite solicitar a entrada do usuário nos servidores listados em `JOIN_GUILD_IDS`. O usuário sempre vê a tela oficial de consentimento do Discord.

O servidor de destino é o servidor onde `!painel-adicionar` foi executado. Assim, um processamento no servidor X adiciona somente no X; outro processamento no servidor Y pode adicionar a mesma pessoa no Y. O bot precisa estar no servidor de destino e o Discord aplica rate limits. O bot precisa ter permissao para atribuir `VERIFIED_ROLE_ID` no servidor principal. Nunca publique `.env` nem compartilhe o token do bot.

## Painel administrativo

Use `!painel-adicionar` em qualquer servidor onde o bot esteja. O comando abre um painel visivel apenas para a equipe com permissao **Gerenciar servidor**. Informe:

- quantidade de membros a processar;
- numero maximo de falhas permitidas.

O bot processa somente pessoas que autorizaram o OAuth2 no botao de verificacao. As autorizações ficam salvas localmente para sobreviver a reinicializações, e o histórico é separado por servidor. O bot confirma a presença no servidor do comando e mostra o resultado no relatório. A autorização pode ser revogada pelo usuário no Discord. Nunca compartilhe a pasta `data/`, pois ela contém credenciais OAuth2.

Para o prefixo funcionar, ative **Message Content Intent** em Developer Portal > Bot > Privileged Gateway Intents.

## Deploy no Railway

1. Crie um projeto no Railway e escolha **Deploy from GitHub Repo**.
2. Selecione `zinhohack24-afk/MrVerification`.
3. Cadastre as variáveis do `.env.example` em **Variables**. Não envie `.env` para o GitHub.
4. Faça o deploy. O Railway fornecerá um domínio público, por exemplo `https://mrverification-production.up.railway.app`.
5. Atualize `OAUTH_REDIRECT_URI` para `https://SEU-DOMINIO.up.railway.app/oauth/callback`.
6. No Discord Developer Portal, em **OAuth2 > General > Redirects**, cadastre exatamente a mesma URL.
7. No Railway, faça um novo deploy e teste `https://SEU-DOMINIO.up.railway.app/health`. A resposta esperada é `{"status":"ok"...}`.

O Railway fornece `PORT` automaticamente; o bot já escuta essa porta e o host `0.0.0.0`. O arquivo `data/authorized-members.json` usa armazenamento local. Para preservar autorizações entre redeploys, adicione um **Volume** no Railway montado em `/app/data` ou troque a persistência por um banco de dados.

Para conectar o bot a um canal de voz mutado, adicione `VOICE_CHANNEL_ID` com o ID do canal. No Railway, o valor atual é `1522518246694191284`. O bot precisa das permissões **Ver canal**, **Conectar** e **Falar**; ele entra com microfone mutado e áudio desativado.