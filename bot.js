// Sigmahacks Whitelist Bot
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
            headers: {
                "X-Secret":     WORKER_SECRET,
                "Content-Type": "application/json",
            },
        };
        const req = (isHttps ? https : http).request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({}); }
            });
        });
        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const get  = path        => workerRequest("GET",  path);
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
const GREY   = 0x555577;

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
            return msg.reply({ embeds: [embed("🗑️ Removed", `**${user}** has been removed from the whitelist.`, YELLOW)] });
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

    // !deactivate <user>  — keeps user in whitelist but blocks login
    deactivate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!deactivate <username>`");
        const user = args[0];
        const data = await post("/deactivate", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("⏸️ Deactivated", `**${user}** has been deactivated and cannot log in.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        if (data.error === "already_inactive")
            return msg.reply({ embeds: [embed("Already Inactive", `**${user}** is already deactivated.`, GREY)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !activate <user>  — re-enables a deactivated user
    activate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!activate <username>`");
        const user = args[0];
        const data = await post("/activate", { user });
        if (data.ok)
            return msg.reply({ embeds: [embed("▶️ Activated", `**${user}** has been activated and can log in again.`, GREEN)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not whitelisted.`, RED)] });
        if (data.error === "already_active")
            return msg.reply({ embeds: [embed("Already Active", `**${user}** is already active.`, GREY)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !listusers
    listusers: async (msg) => {
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("Whitelist", "No users whitelisted yet.", YELLOW)] });
        const lines = users.map((u, i) => {
            const status = u.inactive ? "⏸️" : "✅";
            return `\`${i + 1}.\` ${status} **${u.name ?? u}**`;
        }).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines, BLUE)] });
    },

    // !checkuser <user>
    checkuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!checkuser <username>`");
        const user  = args[0];
        const data  = await get("/list");
        const users = data.users ?? [];
        const found = users.find(u => (u.name ?? u).toLowerCase() === user.toLowerCase());
        if (found) {
            const inactive = found.inactive ?? false;
            return msg.reply({ embeds: [embed(
                inactive ? "⏸️ Whitelisted (Inactive)" : "✅ Whitelisted (Active)",
                inactive
                    ? `**${user}** is whitelisted but currently **deactivated**.`
                    : `**${user}** is whitelisted and **active**.`,
                inactive ? YELLOW : GREEN
            )] });
        }
        return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is NOT whitelisted.`, RED)] });
    },

    // !help
    help: async (msg) => {
        return msg.reply({ embeds: [embed("📖 Commands", [
            "`!adduser <user> <pass>` — whitelist a user",
            "`!removeuser <user>` — permanently remove a user",
            "`!setpass <user> <newpass>` — change a password",
            "`!activate <user>` — allow a user to log in",
            "`!deactivate <user>` — block a user without removing them",
            "`!listusers` — show all users with their status",
            "`!checkuser <user>` — check if a user exists and their status",
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
        msg.reply("❌ Something went wrong: " + err.message);
    }
});

client.once("ready", () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🌐 Worker: ${WORKER_URL}`);
});

// Keep-alive for Railway
http.createServer((req, res) => res.end("ok")).listen(process.env.PORT || 3000);

client.login(BOT_TOKEN);