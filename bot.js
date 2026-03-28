// ═══════════════════════════════════════════════════════════════════
//  bot.js — Sigmahacks Whitelist Bot
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

const get  = path        => workerRequest("GET",  path);
const post = (path, body) => workerRequest("POST", path, body);

// ── Auth: owner OR admin ──────────────────────────────────────────────
async function isAuthorized(userId) {
    if (userId === OWNER_ID) return true;
    const data = await get("/listadmins");
    return (data.admins ?? []).includes(userId);
}

// ── Embed helpers ─────────────────────────────────────────────────────
const GREEN  = 0x3cc86e;
const RED    = 0xdc4646;
const YELLOW = 0xdcb43c;
const BLUE   = 0x4a9eff;
const GREY   = 0x5c6070;

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
            return msg.reply({ embeds: [embed("🗑️ User Removed", `**${user}** has been permanently removed.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not in the whitelist.`, RED)] });
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
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not in the whitelist.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !activate <user>
    activate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!activate <username>`");
        const user = args[0];
        const data = await post("/setstatus", { user, status: "active" });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ Activated", `**${user}** can now log in.`, GREEN)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not in the whitelist.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !deactivate <user>
    deactivate: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!deactivate <username>`");
        const user = args[0];
        const data = await post("/setstatus", { user, status: "inactive" });
        if (data.ok)
            return msg.reply({ embeds: [embed("🚫 Deactivated", `**${user}** is blocked from logging in but not deleted.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `**${user}** is not in the whitelist.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !listusers
    listusers: async (msg) => {
        const data  = await get("/list");
        const users = data.users ?? [];
        if (users.length === 0)
            return msg.reply({ embeds: [embed("Whitelist", "No users yet.", YELLOW)] });
        const lines = users.map((u, i) => {
            const status = u.active ? "🟢" : "🔴";
            return `\`${i + 1}.\` ${status} **${u.name}**`;
        }).join("\n");
        return msg.reply({ embeds: [embed(`📋 Whitelist — ${users.length} user(s)`, lines + "\n\n🟢 = active  🔴 = deactivated", BLUE)] });
    },

    // !checkuser <user>
    checkuser: async (msg, args) => {
        if (args.length < 1) return msg.reply("Usage: `!checkuser <username>`");
        const user = args[0];
        const data = await get("/list");
        const found = (data.users ?? []).find(u => u.name.toLowerCase() === user.toLowerCase());
        if (found) {
            const status = found.active ? "🟢 Active — can log in" : "🔴 Deactivated — blocked";
            return msg.reply({ embeds: [embed("User Found", `**${user}**\nStatus: ${status}`, found.active ? GREEN : YELLOW)] });
        }
        return msg.reply({ embeds: [embed("❌ Not Found", `**${user}** is not in the whitelist.`, RED)] });
    },

    // !addadmin <@user or ID>
    addadmin: async (msg, args) => {
        if (msg.author.id !== OWNER_ID)
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can manage admins.", RED)] });
        if (args.length < 1) return msg.reply("Usage: `!addadmin <@user or ID>`");
        const id = args[0].replace(/[<@!>]/g, "");
        const data = await post("/addadmin", { id });
        if (data.ok)
            return msg.reply({ embeds: [embed("✅ Admin Added", `<@${id}> can now manage the whitelist.`, GREEN)] });
        if (data.error === "already_admin")
            return msg.reply({ embeds: [embed("Already Admin", `<@${id}> is already an admin.`, YELLOW)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !removeadmin <@user or ID>
    removeadmin: async (msg, args) => {
        if (msg.author.id !== OWNER_ID)
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can manage admins.", RED)] });
        if (args.length < 1) return msg.reply("Usage: `!removeadmin <@user or ID>`");
        const id = args[0].replace(/[<@!>]/g, "");
        const data = await post("/removeadmin", { id });
        if (data.ok)
            return msg.reply({ embeds: [embed("🗑️ Admin Removed", `<@${id}> is no longer an admin.`, YELLOW)] });
        if (data.error === "not_found")
            return msg.reply({ embeds: [embed("Not Found", `<@${id}> is not an admin.`, RED)] });
        return msg.reply({ embeds: [embed("Error", data.error ?? "Unknown error", RED)] });
    },

    // !listadmins
    listadmins: async (msg) => {
        if (msg.author.id !== OWNER_ID)
            return msg.reply({ embeds: [embed("No Permission", "Only the owner can view admins.", RED)] });
        const data   = await get("/listadmins");
        const admins = data.admins ?? [];
        if (admins.length === 0)
            return msg.reply({ embeds: [embed("Admins", "No admins set yet. Only you (owner) have access.", YELLOW)] });
        const lines = admins.map((id, i) => `\`${i + 1}.\` <@${id}> (${id})`).join("\n");
        return msg.reply({ embeds: [embed(`🛡️ Admins — ${admins.length}`, lines, BLUE)] });
    },

    // !help
    help: async (msg) => {
        return msg.reply({ embeds: [embed("📖 Commands", [
            "**User Management**",
            "`!adduser <user> <pass>` — add a user",
            "`!removeuser <user>` — permanently remove a user",
            "`!setpass <user> <pass>` — change a password",
            "`!activate <user>` — let a user log in again",
            "`!deactivate <user>` — block without deleting",
            "`!listusers` — show all users + status",
            "`!checkuser <user>` — check if a user exists",
            "",
            "**Admin Management** *(owner only)*",
            "`!addadmin <@user or ID>` — give someone admin",
            "`!removeadmin <@user or ID>` — remove admin",
            "`!listadmins` — list all admins",
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
    if (!msg.content.startsWith("!")) return;

    const parts   = msg.content.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args    = parts.slice(1);

    if (!COMMANDS[command]) return;

    // Check auth — owner or admin can run user commands
    // Only owner can run admin commands (handled inside each command)
    const authed = await isAuthorized(msg.author.id);
    if (!authed) return;

    try {
        await COMMANDS[command](msg, args);
    } catch (err) {
        console.error(err);
        msg.reply("❌ Error: " + err.message);
    }
});

client.once("ready", () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🌐 Worker: ${WORKER_URL}`);
});

// Keep-alive for Railway
http.createServer((req, res) => res.end("ok")).listen(process.env.PORT || 3000);

client.login(BOT_TOKEN);