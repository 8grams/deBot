require('dotenv').config();

const { Client, Intents, ClientUser, Guild, TextChannel} = require('discord.js');
const {
    deployFunction,
    releaseFunction,
    restartFunction,
    getStatusFunction,
    buildFunction,
    runCommand,
    syncFunction
} = require('./command');
const server = require('./server');
const { command } = require('yargs');

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.GUILD_INTEGRATIONS,
        Intents.FLAGS.MESSAGE_CONTENT
    ]
});
const listMessage = {};

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const adminUsers = ['774193845247410196'];
    for(let key in adminUsers) {
        const user = adminUsers[key];
        try {
            const userDiscord = new ClientUser(client, {
                id: user,
            });
        
            await userDiscord.send('Hello, I am ready');
        } catch(err) {
            console.log({err});
            console.log(`Error on send message to ${user.username}`);
        }
    }

    // send to channel
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const guild = new Guild(client, {
        id: channelId,
    });
    const channel = new TextChannel(guild, {
        id: channelId
    }, client);
    await channel.send(`I am ready now!`); 
});

client.login(process.env.CLIENT_TOKEN);

client.on('interactionCreate', interaction => {
	console.log(`${interaction.user.tag} in #${interaction.channel.name} triggered an interaction.`);
});


client.on('messageCreate', async (msg) => {
    const prefixCommand = process.env.DISCORD_PREFIX_COMMAND;

    const splitMessage = msg.content.split(/\s+/);
    const leading = splitMessage[0].toUpperCase();
    const params = splitMessage.slice(1);
    if(msg.author.bot) {
        return;
    }

    if(leading === 'PING') {
        await msg.reply('PONG');
    } else if(leading === `${prefixCommand}!DEPLOY`) {
        await deployFunction(msg, params);
    } else if(leading === `${prefixCommand}!RELEASE`) {
        await releaseFunction(msg, params);
    } else if(leading === `${prefixCommand}!RESTART`) {
        await restartFunction(msg, params);
    } else if(leading === `${prefixCommand}!STATUS`) {
        await getStatusFunction(msg, params);
    } else if(leading === `${prefixCommand}!BUILD`) {
        await buildFunction(msg, params);
    } else if(leading === `${prefixCommand}!SYNC`) {
        await syncFunction(msg, params);
    } else if(leading === `${prefixCommand}!RUN`) {
        const checkRegex = new RegExp(leading, 'i');
        const msgContent = msg.content;
        const pMsgContent = msgContent.replace(checkRegex, leading);
        try{
            const p = await parseCommand(`${prefixCommand}!RUN <type>`, pMsgContent);
            await runCommand(msg, params, p);
        } catch(err) {
            await runCommand(msg, params, {})
        }
    }
});

async function parseCommand(cmd, cmdMessage){
    return new Promise(async (resolve, reject) => {
        const parser = command(cmd);
        const p = await parser.parseAsync(cmdMessage, function(err){
            if(err){
                reject(err);
            }
        });
        resolve(p);
    })
}

server({
    client,
    listMessage
});
