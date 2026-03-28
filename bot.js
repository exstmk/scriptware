// ═══════════════════════════════════════════════════════════════════
//  bot.js — Sigmahacks Whitelist Discord Bot (Railway)
//
//  Commands (DM the bot):
//    !adduser <user> <pass>
//    !removeuser <user>
//    !setpass <user> <newpass>
//    !deactivate <user>        ← ban without deleting
//    !activate <user>          ← re-enable a deactivated user
//    !listusers
//    !checkuser <user>
//    !showpass <user>
//    !help
// ═══════════════════════════════════════════════════════════════════

// Sigmahacks Whitelist Bot
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const https = require("https");
const http  = require("http");

const BOT_TOKEN     = process.env.BOT_TOKEN;
const OWNER_ID      = process.env.OWNER_ID;
const WORKER_URL    = (process.env.WORKER_URL ?? "").replace(/\/$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET;

if (!BOT_TOKEN || !OWNER_ID || !WORKER_URL || !WORKER_SECRET) {
    console.error("❌ Missing environment variables.");
    process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────────────────────
function workerRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(WORKER_URL + path);
        const isHttps = fullUrl.protocol === "https:";
        const options = {
            hostname: fullUrl.hostname,
            port:     fullUrl.port || (isHttps ? 443 : 80),
            path:     fullUrl.pathname + fullUrl.search,
            method,
            headers: { "X-Secret": WORKER_SECRET, "Content-Type": "application/json" },
        };
        const req = (isHttps ? https : http).request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const get  = path         => workerRequest("GET",  path);
const post = (path, body) => workerRequest("POST", path, body);

// ── Embed helper ──────────────────────────────────────────────────────
function embed(title, desc, color = 0x4a9eff) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(color)
        .setFooter({ text: "Sigmahacks Whitelist" })
        .setTimestamp();
}

const GREEN  = 0x3cc86e;
const RED    = 0xdc4646;
const YELLOW = 0xdcb43c;
const BLUE   = 0x4a9eff;
const PURPLE = 0x9b59b6;
const ORANGE = 0xe67e22;

// ── Commands ──────────────────────────────────────────────────────────
const COMMANDS = {

    // !adduser <user> <pass>
    adduser: async (msg, args) => {
        if (args.length < 2) return msg.reply("Usage: `!adduser <username> <password>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/add", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ User Added", `**${user}** has been added to the whitelist.`, GREEN)] });
        if (data.error === "already_exists")
            return msg.reply({ embeds: [embed("Already Exists", `**${user}** is already whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !removeuser <user>
    removeuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!removeuser <username>`");
        const user = args[0];
        const data = await post("/remove", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("🗑️ Removed", `**${user}** has been permanently removed.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !setpass <user> <newpass>
    setpass: async (msg, args) => {
        if (args.length < 2) return msg.reply("Usage: `!setpass <username> <newpassword>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/setpass", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("🔑 Password Updated", `Password changed for **${user}**.`, BLUE)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !deactivate <user>
    // Blocks the user from logging in without deleting them
    deactivate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!deactivate <username>`");
        const user = args[0];
        const data = await post("/deactivate", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("⛔ User Deactivated", `**${user}** has been deactivated and can no longer log in.\nUse \`!activate ${user}\` to re-enable them.`, ORANGE)] });
        if (data.error === "already_deactivated")
            return msg.reply({ embeds: [embed("Already Deactivated", `**${user}** is already deactivated.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !activate <user>
    // Re-enables a deactivated user
    activate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!activate <username>`");
        const user = args[0];
        const data = await post("/activate", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ User Activated", `**${user}** has been re-activated and can log in again.`, GREEN)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !listusers
    listusers: async (msg) => {
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("Whitelist", "No users whitelisted yet.", YELLOW)] });
        const lines = users.map((u, i) => {
            const status = u.deactivated ? "⛔" : "✅";
            return `\`${i + 1}.\` ${status} **${u.name}**`;
        }).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines, BLUE)] });
    },

    // !checkuser <user>
    checkuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!checkuser <username>`");
        const user  = args[0].toLowerCase();
        const data  = await get("/list");
        const users = data.users ?? [];
        const found = users.find(u => u.name.toLowerCase() === user);
        if (!found)
            return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is NOT whitelisted.`, RED)] });
        if (found.deactivated)
            return msg.reply({ embeds: [embed("⛔ Deactivated", `**${user}** is whitelisted but currently deactivated.`, ORANGE)] });
        return msg.reply({ embeds: [embed("✅ Whitelisted", `**${user}** is active and can log in.`, GREEN)] });
    },

    // !showpass <user>
    showpass: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!showpass <username>`");
        const user = args[0].toLowerCase();
        const data = await get(`/getpass?user=${encodeURIComponent(user)}`);
        if (data.error === "not_found" || !data.pass)
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not in the whitelist.`, RED)] });
        try {
            const dm = await msg.author.createDM();
            await dm.send({ embeds: [
                new EmbedBuilder()
                    .setTitle(`🔐 Password for ${user}`)
                    .setDescription(`\`\`\`${data.pass}\`\`\``)
                    .setColor(PURPLE)
                    .setFooter({ text: "Do not share this — Sigmahacks Whitelist" })
                    .setTimestamp()
            ]});
            if (msg.channel.type !== 1)
                return msg.reply("📬 Password sent to your DMs.");
        } catch {
            return msg.reply("❌ Couldn't DM you. Make sure your DMs are open.");
        }
    },

    // !help
    help: async (msg) => {
        return msg.reply({ embeds: [embed("📖 Commands", [
            "`!adduser <user> <pass>` — add a user",
            "`!removeuser <user>` — permanently remove a user",
            "`!setpass <user> <pass>` — change a password",
            "`!deactivate <user>` — block login without deleting",
            "`!activate <user>` — re-enable a deactivated user",
            "`!listusers` — list all users with status",
            "`!checkuser <user>` — check if a user can log in",
            "`!showpass <user>` — DMs you their password",
        ].join("\n"), BLUE)] });
    },
};

// ── Discord client ────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: ["CHANNEL"],
});

client.on("messageCreate", async msg => {
    if (msg.author.bot)             return;
    if (msg.author.id !== OWNER_ID) return;
    if (!msg.content.startsWith("!")) return;

    const parts   = msg.content.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args    = parts.slice(1);

    if (!COMMANDS[command]) return;

    try {
        await COMMANDS[command](msg, args);
    } catch (err) {
        console.error(err);
        msg.reply("❌ Something went wrong: " + err.message);
    }
});

client.once("ready", () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🌐 Worker: ${WORKER_URL}`);
});

// Keep-alive for Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("ok")).listen(PORT);

client.login(BOT_TOKEN);