// ═══════════════════════════════════════════════════════════════════
//  bot.js — Sigmahacks Whitelist Bot (Railway)
//  Works in DMs AND servers. Owner-only commands.
// ═══════════════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, GatewayIntentBits: Intents, EmbedBuilder, Partials } = require("discord.js");
const https = require("https");
const http  = require("http");

const BOT_TOKEN     = process.env.BOT_TOKEN;
const OWNER_ID      = process.env.OWNER_ID;
const WORKER_URL    = (process.env.WORKER_URL ?? "").replace(/\/$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET;

if (!BOT_TOKEN || !OWNER_ID || !WORKER_URL || !WORKER_SECRET) {
    console.error("❌ Missing environment variables."); process.exit(1);
}

// ── HTTP helper (no deps, pure node) ─────────────────────────────────
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
            res.on("data", c => data += c);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const get  = path        => workerRequest("GET",  path);
const post = (path, body) => workerRequest("POST", path, body);

// ── Embed helper ──────────────────────────────────────────────────────
const GREEN  = 0x3cc86e;
const RED    = 0xdc4646;
const YELLOW = 0xdcb43c;
const BLUE   = 0x4a9eff;
const PURPLE = 0x9b59b6;

function embed(title, desc, color = BLUE) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(color)
        .setFooter({ text: "Sigmahacks Whitelist" })
        .setTimestamp();
}

// ── Commands ──────────────────────────────────────────────────────────
const COMMANDS = {

    // !adduser <user> <pass>
    adduser: async (msg, args) => {
        if (args.length < 2) return msg.reply("Usage: `!adduser <username> <password>`");
        const user = args[0].toLowerCase();
        const pass = args.slice(1).join(" ");
        const data = await post("/add", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ User Added", `**${user}** has been added to the whitelist.`, GREEN)] });
        if (data.error === "already_exists")
            return msg.reply({ embeds: [embed("⚠️ Already Exists", `**${user}** is already whitelisted.`, YELLOW)] });
        return msg.reply({ embeds: [embed("❌ Error", data.error ?? "Unknown error", RED)] });
    },

    // !removeuser <user>
    removeuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!removeuser <username>`");
        const user = args[0].toLowerCase();
        const data = await post("/remove", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("🗑️ User Removed", `**${user}** has been removed from the whitelist.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is not in the whitelist.`, RED)] });
        return msg.reply({ embeds: [embed("❌ Error", data.error ?? "Unknown error", RED)] });
    },

    // !setpass <user> <newpass>
    setpass: async (msg, args) => {
        if (args.length < 2) return msg.reply("Usage: `!setpass <username> <newpassword>`");
        const user = args[0].toLowerCase();
        const pass = args.slice(1).join(" ");
        const data = await post("/setpass", { user, pass });
        if (data.ok)
            return msg.reply({ embeds: [embed("🔑 Password Updated", `Password changed for **${user}**.`, BLUE)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is not in the whitelist.`, RED)] });
        return msg.reply({ embeds: [embed("❌ Error", data.error ?? "Unknown error", RED)] });
    },

    // !listusers
    listusers: async (msg) => {
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("📋 Whitelist", "No users whitelisted yet.", YELLOW)] });
        const lines = users.map((u, i) => `\`${i + 1}.\` **${u}**`).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines, BLUE)] });
    },

    // !checkuser <user>
    checkuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!checkuser <username>`");
        const user  = args[0].toLowerCase();
        const data  = await get("/list");
        const users = (data.users ?? []).map(u => u.toLowerCase());
        if (users.includes(user))
            return msg.reply({ embeds: [embed("✅ Whitelisted", `**${user}** is in the whitelist.`, GREEN)] });
        return msg.reply({ embeds: [embed("❌ Not Whitelisted", `**${user}** is NOT in the whitelist.`, RED)] });
    },

    // !renameuser <olduser> <newuser>
    renameuser: async (msg, args) => {
        if (args.length < 2) return msg.reply("Usage: `!renameuser <oldusername> <newusername>`");
        const oldUser = args[0].toLowerCase();
        const newUser = args[1].toLowerCase();
        // Get old password first
        const listData = await get("/list");
        const users = listData.users ?? [];
        if (!users.map(u => u.toLowerCase()).includes(oldUser))
            return msg.reply({ embeds: [embed("❌ Not Found", `**${oldUser}** is not in the whitelist.`, RED)] });
        // Check new name not taken
        if (users.map(u => u.toLowerCase()).includes(newUser))
            return msg.reply({ embeds: [embed("⚠️ Taken", `**${newUser}** is already in the whitelist.`, YELLOW)] });
        // We need the password — get it via a check trick: just remove and re-add
        // Since we can't fetch the password, we'll do remove + notify owner to re-add
        // Instead: add new with temp pass, then owner can setpass
        return msg.reply({ embeds: [embed("ℹ️ How to Rename", [
            `To rename a user, you need to:`,
            `1. \`!removeuser ${oldUser}\``,
            `2. \`!adduser ${newUser} <their password>\``,
            `Or just change their password with \`!setpass\``,
        ].join("\n"), BLUE)] });
    },

    // !clearall  — wipe entire whitelist
    clearall: async (msg) => {
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("📋 Whitelist", "Already empty.", YELLOW)] });
        // Remove all users one by one
        let removed = 0;
        for (const user of users) {
            const r = await post("/remove", { user });
            if (r.ok) removed++;
        }
        return msg.reply({ embeds: [embed("🗑️ Whitelist Cleared", `Removed **${removed}** user(s) from the whitelist.`, RED)] });
    },

    // !usercount
    usercount: async (msg) => {
        const data  = await get("/list");
        const count = (data.users ?? []).length;
        return msg.reply({ embeds: [embed("👥 User Count", `There are currently **${count}** whitelisted user(s).`, PURPLE)] });
    },

    // !help
    help: async (msg) => {
        return msg.reply({ embeds: [embed("📖 All Commands", [
            "**User Management**",
            "`!adduser <user> <pass>` — add a user",
            "`!removeuser <user>` — remove a user",
            "`!setpass <user> <newpass>` — change a password",
            "`!listusers` — list all whitelisted users",
            "`!checkuser <user>` — check if a user is whitelisted",
            "`!usercount` — show total user count",
            "`!clearall` — remove ALL users from whitelist",
            "",
            "**Tips**",
            "• Usernames are case-insensitive",
            "• Passwords are case-sensitive",
            "• Changes take effect immediately",
        ].join("\n"), BLUE)] });
    },
};

// ── Discord client — partials needed for DMs ──────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
        Partials.Channel,   // ← required for DMs to work
        Partials.Message,
    ],
});

client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
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
        msg.reply("❌ Error: " + err.message).catch(() => {});
    }
});

client.once("ready", () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🌐 Worker: ${WORKER_URL}`);
    console.log(`👤 Owner: ${OWNER_ID}`);
});

// Keep-alive for Railway
http.createServer((req, res) => res.end("ok")).listen(process.env.PORT || 3000);

client.login(BOT_TOKEN);