// ═══════════════════════════════════════════════════════════════════
//  bot.js — Sigmahacks Whitelist Discord Bot (Railway)
//
//  Owner commands (only your OWNER_ID):
//    !adduser <user> <pass>       — whitelist a user
//    !removeuser <user>           — remove a user
//    !setpass <user> <newpass>    — change a password
//    !listusers                   — list all users
//    !checkuser <user>            — check if user exists
//    !admin add <@user or ID>     — give someone admin perms
//    !admin remove <@user or ID>  — remove someone's admin perms
//    !admin list                  — show all admins
//
//  Admin commands (users granted by owner via !admin add):
//    !adduser, !removeuser, !checkuser, !listusers
//    (admins CANNOT use !setpass or !admin)
// ═══════════════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const https = require("https");
const http  = require("http");

const BOT_TOKEN     = process.env.BOT_TOKEN;
const OWNER_ID      = process.env.OWNER_ID;
const WORKER_URL    = (process.env.WORKER_URL ?? "").replace(/\/$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET;

if (!BOT_TOKEN || !OWNER_ID || !WORKER_URL || !WORKER_SECRET) {
    console.error("❌ Missing environment variables. Check Railway settings.");
    process.exit(1);
}

// ── Admin list (stored in Cloudflare KV under key __admins) ───────────
// We reuse the same KV via the worker so no extra storage needed.

async function getAdmins() {
    try {
        const data = await workerGet("/admins");
        return Array.isArray(data.admins) ? data.admins : [];
    } catch { return []; }
}

async function setAdmins(admins) {
    return await post("/admins", { admins });
}

function isOwner(id)       { return id === OWNER_ID; }
async function isAdmin(id) { const admins = await getAdmins(); return admins.includes(id); }
async function canManage(id) { return isOwner(id) || await isAdmin(id); }

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

const workerGet = path        => workerRequest("GET",  path);
const post      = (path, body) => workerRequest("POST", path, body);

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

// ── Parse a user ID from a mention or raw ID ──────────────────────────
function parseUserId(str) {
    if (!str) return null;
    // Strip mention formatting <@123456> or <@!123456>
    const match = str.match(/^<@!?(\d+)>$/) || str.match(/^(\d+)$/);
    return match ? match[1] : null;
}

// ── Commands ──────────────────────────────────────────────────────────
const COMMANDS = {

    // !adduser <user> <pass>  — owner + admin
    adduser: async (msg, args) => {
        if (!await canManage(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "You don't have permission to do that.", RED)] });
        if (args.length < 2)
            return msg.reply("Usage: `!adduser <username> <password>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/add", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ User Added", `**${user}** added to whitelist.`, GREEN)] });
        if (data.error === "already_exists")
            return msg.reply({ embeds: [embed("Already Exists", `**${user}** is already whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !removeuser <user>  — owner + admin
    removeuser: async (msg, args) => {
        if (!await canManage(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "You don't have permission to do that.", RED)] });
        if (args.length < 1)
            return msg.reply("Usage: `!removeuser <username>`");
        const user = args[0];
        const data = await post("/remove", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("🗑️ Removed", `**${user}** removed from whitelist.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !setpass <user> <newpass>  — owner only
    setpass: async (msg, args) => {
        if (!isOwner(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can change passwords.", RED)] });
        if (args.length < 2)
            return msg.reply("Usage: `!setpass <username> <newpassword>`");
        const [user, pass] = [args[0], args.slice(1).join(" ")];
        const data = await post("/setpass", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("🔑 Password Updated", `Password changed for **${user}**.`, BLUE)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !listusers  — owner + admin
    listusers: async (msg) => {
        if (!await canManage(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "You don't have permission to do that.", RED)] });
        const data  = await workerGet("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("Whitelist", "No users whitelisted yet.", YELLOW)] });
        const lines = users.map((u, i) => `\`${i + 1}.\` **${u}**`).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines, BLUE)] });
    },

    // !checkuser <user>  — owner + admin
    checkuser: async (msg, args) => {
        if (!await canManage(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "You don't have permission to do that.", RED)] });
        if (args.length < 1)
            return msg.reply("Usage: `!checkuser <username>`");
        const user  = args[0];
        const data  = await workerGet("/list");
        const users = (data.users ?? []).map(u => u.toLowerCase());
        if (users.includes(user.toLowerCase()))
            return msg.reply({ embeds: [embed("✅ Whitelisted", `**${user}** is in the whitelist.`, GREEN)] });
        return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is NOT whitelisted.`, RED)] });
    },

    // !admin add/remove/list  — owner only
    admin: async (msg, args) => {
        if (!isOwner(msg.author.id))
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can manage admins.", RED)] });

        const sub = (args[0] ?? "").toLowerCase();

        // !admin list
        if (sub === "list") {
            const admins = await getAdmins();
            if (admins.length === 0)
                return msg.reply({ embeds: [embed("👑 Admins", "No admins set yet.", YELLOW)] });
            const lines = admins.map((id, i) => `\`${i + 1}.\` <@${id}> (${id})`).join("\n");
            return msg.reply({ embeds: [embed(`👑 Admins — ${admins.length}`, lines, PURPLE)] });
        }

        // !admin add <@user or ID>
        if (sub === "add") {
            const targetId = parseUserId(args[1]);
            if (!targetId)
                return msg.reply("Usage: `!admin add <@user or user ID>`");
            if (targetId === OWNER_ID)
                return msg.reply({ embeds: [embed("Already Owner", "That's you — you already have full access.", YELLOW)] });
            const admins = await getAdmins();
            if (admins.includes(targetId))
                return msg.reply({ embeds: [embed("Already Admin", `<@${targetId}> is already an admin.`, YELLOW)] });
            admins.push(targetId);
            await setAdmins(admins);
            return msg.reply({ embeds: [embed("✅ Admin Added", `<@${targetId}> can now use \`!adduser\`, \`!removeuser\`, \`!checkuser\`, \`!listusers\`.`, PURPLE)] });
        }

        // !admin remove <@user or ID>
        if (sub === "remove") {
            const targetId = parseUserId(args[1]);
            if (!targetId)
                return msg.reply("Usage: `!admin remove <@user or user ID>`");
            const admins = await getAdmins();
            if (!admins.includes(targetId))
                return msg.reply({ embeds: [embed("Not Found", `<@${targetId}> is not an admin.`, RED)] });
            await setAdmins(admins.filter(id => id !== targetId));
            return msg.reply({ embeds: [embed("🗑️ Admin Removed", `<@${targetId}> no longer has admin access.`, YELLOW)] });
        }

        return msg.reply("Usage: `!admin add/remove/list <@user or ID>`");
    },

    // !help
    help: async (msg) => {
        const admin = await canManage(msg.author.id);
        const owner = isOwner(msg.author.id);
        const lines = [];

        if (admin) {
            lines.push("**Whitelist Commands**");
            lines.push("`!adduser <user> <pass>` — whitelist a user");
            lines.push("`!removeuser <user>` — remove a user");
            lines.push("`!checkuser <user>` — check if a user exists");
            lines.push("`!listusers` — list all whitelisted users");
        }
        if (owner) {
            lines.push("");
            lines.push("**Owner Only**");
            lines.push("`!setpass <user> <newpass>` — change a password");
            lines.push("`!admin add <@user>` — give someone admin access");
            lines.push("`!admin remove <@user>` — remove admin access");
            lines.push("`!admin list` — show all admins");
        }
        if (!admin && !owner) {
            lines.push("You don't have permission to use any commands.");
        }

        return msg.reply({ embeds: [embed("📖 Commands", lines.join("\n"), BLUE)] });
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