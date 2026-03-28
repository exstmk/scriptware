// ═══════════════════════════════════════════════════════════════════
//  bot.js — Sigmahacks Whitelist Bot with Admin System
// ═══════════════════════════════════════════════════════════════════

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

// ── Admin list ────────────────────────────────────────────────────────
// Admins can use all whitelist commands.
// Only the owner can add/remove admins.
const admins = new Set();

function isOwner(id) { return id === OWNER_ID; }
function isAdmin(id) { return isOwner(id) || admins.has(id); }

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

// ── Commands ──────────────────────────────────────────────────────────
const COMMANDS = {

    // ── Whitelist commands (owner + admins) ───────────────────────────

    adduser: async (msg, args) => {
        if (!isAdmin(msg.author.id)) return;
        if (args.length < 2) return msg.reply("Usage: `!adduser <username> <password>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/add", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ User Added", `**${user}** added to whitelist.`, GREEN)] });
        if (data.error === "already_exists")
            return msg.reply({ embeds: [embed("Already Exists", `**${user}** is already whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    removeuser: async (msg, args) => {
        if (!isAdmin(msg.author.id)) return;
        if (args.length < 1) return msg.reply("Usage: `!removeuser <username>`");
        const user = args[0];
        const data = await post("/remove", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("🗑️ Removed", `**${user}** removed from whitelist.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    setpass: async (msg, args) => {
        if (!isAdmin(msg.author.id)) return;
        if (args.length < 2) return msg.reply("Usage: `!setpass <username> <newpassword>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/setpass", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("🔑 Password Updated", `Password changed for **${user}**.`, BLUE)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    listusers: async (msg) => {
        if (!isAdmin(msg.author.id)) return;
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("Whitelist", "No users whitelisted yet.", YELLOW)] });
        const lines = users.map((u, i) => `\`${i + 1}.\` **${u}**`).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines, BLUE)] });
    },

    checkuser: async (msg, args) => {
        if (!isAdmin(msg.author.id)) return;
        if (args.length < 1) return msg.reply("Usage: `!checkuser <username>`");
        const user  = args[0];
        const data  = await get("/list");
        const users = (data.users ?? []).map(u => u.toLowerCase());
        if (users.includes(user.toLowerCase()))
            return msg.reply({ embeds: [embed("✅ Whitelisted", `**${user}** is in the whitelist.`, GREEN)] });
        return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is NOT whitelisted.`, RED)] });
    },

    // ── Admin commands (owner only) ───────────────────────────────────

    addadmin: async (msg, args) => {
        if (!isOwner(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can manage admins.", RED)] });
        if (args.length < 1) return msg.reply("Usage: `!addadmin <@user or userID>`");
        const id = args[0].replace(/[<@!>]/g, "");
        if (!/^\d+$/.test(id)) return msg.reply("Provide a valid user ID or @mention.");
        if (id === OWNER_ID)   return msg.reply("You're already the owner!");
        if (admins.has(id))    return msg.reply({ embeds: [embed("Already Admin", `<@${id}> is already an admin.`, YELLOW)] });
        admins.add(id);
        return msg.reply({ embeds: [embed("👑 Admin Added", `<@${id}> can now use whitelist commands.`, PURPLE)] });
    },

    removeadmin: async (msg, args) => {
        if (!isOwner(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can manage admins.", RED)] });
        if (args.length < 1) return msg.reply("Usage: `!removeadmin <@user or userID>`");
        const id = args[0].replace(/[<@!>]/g, "");
        if (!admins.has(id)) return msg.reply({ embeds: [embed("Not Found", `<@${id}> is not an admin.`, RED)] });
        admins.delete(id);
        return msg.reply({ embeds: [embed("🗑️ Admin Removed", `<@${id}> can no longer use whitelist commands.`, YELLOW)] });
    },

    listadmins: async (msg) => {
        if (!isOwner(msg.author.id)) return;
        if (admins.size === 0)
            return msg.reply({ embeds: [embed("Admins", "No admins yet. Only you (owner) have access.", YELLOW)] });
        const lines = [...admins].map((id, i) => `\`${i + 1}.\` <@${id}>`).join("\n");
        return msg.reply({ embeds: [embed(`👑 Admins — ${admins.size}`, lines, PURPLE)] });
    },

    help: async (msg) => {
        if (!isAdmin(msg.author.id)) return;
        const adminSection = isOwner(msg.author.id) ? "\n\n**Admin Management (owner only)**\n`!addadmin <@user or ID>` — give someone admin\n`!removeadmin <@user or ID>` — remove admin\n`!listadmins` — list all admins" : "";
        return msg.reply({ embeds: [embed("📖 Commands",
            "**Whitelist Commands**\n`!adduser <user> <pass>`\n`!removeuser <user>`\n`!setpass <user> <newpass>`\n`!listusers`\n`!checkuser <user>`" + adminSection,
        BLUE)] });
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
    if (msg.author.bot) return;
    if (!msg.content.startsWith("!")) return;
    if (!isAdmin(msg.author.id)) return;

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
    console.log(`👑 Owner: ${OWNER_ID}`);
});

// Keep-alive for Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("ok")).listen(PORT);

client.login(BOT_TOKEN);