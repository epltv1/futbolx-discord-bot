const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

const { DateTime } = require("luxon");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const API_BASE = "https://www.futbol-x.xyz/api";
const TIMEZONE = "Africa/Nairobi";

const CATEGORIES = [
  "football",
  "tennis",
  "basketball",
  "fights",
  "motorsports",
  "americanfootball",
  "nhl",
  "baseball",
  "rugby",
  "golf",
  "others",
  "wrestling",
  "darts"
];

const CATEGORY_EMOJIS = {
  football: "⚽",
  tennis: "🎾",
  basketball: "🏀",
  fights: "🥊",
  motorsports: "🏎️",
  americanfootball: "🏈",
  nhl: "🏒",
  baseball: "⚾",
  rugby: "🏉",
  golf: "⛳",
  others: "📺",
  wrestling: "🤼",
  darts: "🎯"
};

let previousEvents = null;

function parseEAT(value) {
  if (!value) return null;

  let dt = DateTime.fromISO(String(value), {
    setZone: true
  });

  if (!dt.isValid) {
    dt = DateTime.fromJSDate(new Date(value), {
      zone: TIMEZONE
    });
  }

  return dt.setZone(TIMEZONE);
}

function categoryEmoji(category) {
  return CATEGORY_EMOJIS[category] || "📺";
}

async function fetchCategory(category) {
  try {
    const url = API_BASE + "/" + category + ".json";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "FutbolX-Discord-Bot"
      }
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    // New API structure
    if (data && Array.isArray(data.streams)) {
      const events = [];
      for (const group of data.streams) {
        if (Array.isArray(group.streams)) {
          events.push(...group.streams);
        }
      }
      return events;
    }

    // Fallback
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.events)) {
      return data.events;
    }

    return [];
  } catch (error) {
    console.error("[API] " + category + ": " + error.message);
    return [];
  }
}

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(async category => {
      const events = await fetchCategory(category);

      return events.map(event => ({
        ...event,
        category
      }));
    })
  );

  return results.flat();
}

function processEvents(events) {
  const now = DateTime.now().setZone(TIMEZONE);

  return events
    .map(event => {
      const start = parseEAT(event.starts_at);
      const end = parseEAT(event.ends_at);

      if (!start || !start.isValid) {
        return null;
      }

      const isLive =
        start <= now &&
        (!end ||
          !end.isValid ||
          now <= end);

      return {
        ...event,
        start,
        end,
        isLive
      };
    })
    .filter(Boolean);
}

function getUpcomingEvents(events) {
  const now = DateTime.now().setZone(TIMEZONE);
  const maxTime = now.plus({
    hours: 48
  });

  return events.filter(event => {
    if (!event.start?.isValid) {
      return false;
    }

    if (event.isLive) {
      return false;
    }

    return (
      event.start > now &&
      event.start <= maxTime
    );
  });
}

function formatCountdown(start) {
  const now = DateTime.now().setZone(TIMEZONE);

  const minutes = Math.max(
    0,
    Math.round(
      start.diff(now, "minutes").minutes
    )
  );

  if (minutes < 1) {
    return "starting now";
  }

  if (minutes < 60) {
    return "in " + minutes + " minute" + (minutes === 1 ? "" : "s");
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return "in " + hours + " hour" + (hours === 1 ? "" : "s");
  }

  const days = Math.floor(hours / 24);

  return "in " + days + " day" + (days === 1 ? "" : "s");
}

function buildCategoryData(events) {
  const grouped = {};

  for (const category of CATEGORIES) {
    grouped[category] = [];
  }

  for (const event of events) {
    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }

    grouped[event.category].push(event);
  }

  const checkedAt = DateTime.now()
    .setZone(TIMEZONE)
    .toFormat("HH:mm");

  const result = [];

  for (const category of CATEGORIES) {
    const categoryEvents = grouped[category];

    if (!categoryEvents.length) {
      continue;
    }

    categoryEvents.sort(
      (a, b) =>
        a.start.toMillis() -
        b.start.toMillis()
    );

    const lines = categoryEvents.map(event => {
      const time = event.start.toFormat("h:mm a");
      const countdown = formatCountdown(event.start);

      return "• **" + event.name + "** — **" + time + "** (" + countdown + ")";
    });

    const embed = new EmbedBuilder()
      .setTitle(categoryEmoji(category) + " " + category.toUpperCase())
      .setDescription(lines.join("\n"))
      .setFooter({
        text: "Today at " + checkedAt
      });

    result.push({
      category,
      embed
    });
  }

  return result;
}

function getEmbedCategory(message) {
  const title = message.embeds?.[0]?.title;

  if (!title) {
    return null;
  }

  for (const category of CATEGORIES) {
    if (title === categoryEmoji(category) + " " + category.toUpperCase()) {
      return category;
    }
  }

  return null;
}

function getOldTextCategory(message) {
  const content = String(message.content || "");
  const firstLine = content.split("\n")[0].trim();

  for (const category of CATEGORIES) {
    const normal = categoryEmoji(category) + " **" + category.toUpperCase() + "**";

    if (firstLine === normal) {
      return category;
    }
  }

  return null;
}

function isScheduleMessage(message) {
  if (!client.user || message.author?.id !== client.user.id) {
    return false;
  }

  return Boolean(
    getEmbedCategory(message) ||
    getOldTextCategory(message)
  );
}

function getScheduleCategory(message) {
  return (
    getEmbedCategory(message) ||
    getOldTextCategory(message)
  );
}

async function findScheduleMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (!fetched.size) {
      break;
    }

    for (const message of fetched.values()) {
      if (isScheduleMessage(message)) {
        messages.push(message);
      }
    }

    if (fetched.size < 100) {
      break;
    }

    before = fetched.last().id;
  }

  return messages;
}

async function updateScheduleMessages(channel, categoryData) {
  const existing = await findScheduleMessages(channel);
  const byCategory = new Map();

  for (const message of existing) {
    const category = getScheduleCategory(message);

    if (!category) continue;

    if (!byCategory.has(category)) {
      byCategory.set(category, message);
    }
  }

  const activeMessageIds = new Set();

  for (const item of categoryData) {
    const oldMessage = byCategory.get(item.category);

    if (oldMessage) {
      try {
        await oldMessage.edit({
          content: "",
          embeds: [item.embed]
        });

        activeMessageIds.add(oldMessage.id);
      } catch (error) {
        console.error("[SCHEDULE] Failed editing " + item.category + ":", error.message);
      }
    } else {
      try {
        const newMessage = await channel.send({
          embeds: [item.embed]
        });

        activeMessageIds.add(newMessage.id);

        console.log("[SCHEDULE] New category message: " + item.category);
      } catch (error) {
        console.error("[SCHEDULE] Failed creating " + item.category + ":", error.message);
      }
    }
  }

  for (const message of existing) {
    if (!activeMessageIds.has(message.id)) {
      try {
        await message.delete();
        console.log("[SCHEDULE] Removed inactive category message: " + message.id);
      } catch (error) {
        console.error("[SCHEDULE] Failed deleting old message:", error.message);
      }
    }
  }
}

function isLiveMessage(message) {
  if (!client.user || message.author?.id !== client.user.id) {
    return false;
  }

  return String(message.content || "").includes("🔴 **LIVE NOW**");
}

async function findLiveMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (!fetched.size) {
      break;
    }

    for (const message of fetched.values()) {
      if (isLiveMessage(message)) {
        messages.push(message);
      }
    }

    if (fetched.size < 100) {
      break;
    }

    before = fetched.last().id;
  }

  return messages;
}

function buildLiveMessage(liveEvents) {
  if (!liveEvents.length) {
    return null;
  }

  const lines = liveEvents
    .sort((a, b) => a.start.toMillis() - b.start.toMillis())
    .map(event => "🔴 **" + event.name + "**");

  return [
    "🔴 **LIVE NOW**",
    "",
    lines.join("\n")
  ].join("\n");
}

async function updateLiveMessage(channel, liveEvents) {
  const existing = await findLiveMessages(channel);

  for (const message of existing) {
    try {
      await message.delete();
    } catch (error) {
      console.error("[LIVE] Failed deleting old live message:", error.message);
    }
  }

  if (!liveEvents.length) {
    return;
  }

  const content = buildLiveMessage(liveEvents);

  if (!content) {
    return;
  }

  try {
    await channel.send({
      content
    });
  } catch (error) {
    console.error("[LIVE] Failed sending live message:", error.message);
  }
}

function detectLiveChanges(oldEvents, newEvents) {
  if (!oldEvents) {
    return {
      newlyLive: [],
      endedLive: []
    };
  }

  const oldMap = new Map(
    oldEvents.map(event => [
      event.category + "|" + event.name + "|" + event.starts_at,
      event
    ])
  );

  const newMap = new Map(
    newEvents.map(event => [
      event.category + "|" + event.name + "|" + event.starts_at,
      event
    ])
  );

  const newlyLive = [];
  const endedLive = [];

  for (const event of newEvents) {
    const key = event.category + "|" + event.name + "|" + event.starts_at;
    const oldEvent = oldMap.get(key);

    if (event.isLive && (!oldEvent || !oldEvent.isLive)) {
      newlyLive.push(event);
    }
  }

  for (const oldEvent of oldEvents) {
    const key = oldEvent.category + "|" + oldEvent.name + "|" + oldEvent.starts_at;
    const current = newMap.get(key);

    if (oldEvent.isLive && (!current || !current.isLive)) {
      endedLive.push(oldEvent);
    }
  }

  return {
    newlyLive,
    endedLive
  };
}

async function checkChannel(channel) {
  if (!channel) {
    throw new Error("Discord channel was not found.");
  }

  if (!channel.isTextBased()) {
    throw new Error("Configured channel is not a text-based channel.");
  }

  if (!client.user) {
    throw new Error("Discord client user is not ready.");
  }

  const permissions = channel.permissionsFor(client.user);

  if (!permissions) {
    throw new Error("Could not read bot permissions in the channel.");
  }

  const required = [
    [PermissionsBitField.Flags.ViewChannel, "View Channel"],
    [PermissionsBitField.Flags.SendMessages, "Send Messages"],
    [PermissionsBitField.Flags.EmbedLinks, "Embed Links"],
    [PermissionsBitField.Flags.ReadMessageHistory, "Read Message History"],
    [PermissionsBitField.Flags.ManageMessages, "Manage Messages"]
  ];

  const missing = required
    .filter(([permission]) => !permissions.has(permission))
    .map(([, name]) => name);

  if (missing.length) {
    throw new Error("Missing channel permissions: " + missing.join(", "));
  }
}

async function updateSchedule() {
  try {
    console.log("[SCHEDULE] Checking schedule...");

    const channel = await client.channels.fetch(CHANNEL_ID);

    await checkChannel(channel);

    console.log("[SCHEDULE] Channel found: #" + channel.name);

    const rawEvents = await fetchAllEvents();

    console.log("[SCHEDULE] API returned " + rawEvents.length + " events");

    const events = processEvents(rawEvents);

    const upcomingEvents = getUpcomingEvents(events);

    const liveEvents = events.filter(event => event.isLive);

    console.log("[SCHEDULE] " + upcomingEvents.length + " upcoming, " + liveEvents.length + " live");

    const { newlyLive, endedLive } = detectLiveChanges(previousEvents, events);

    await updateScheduleMessages(channel, buildCategoryData(upcomingEvents));

    if (
      newlyLive.length ||
      endedLive.length ||
      (!previousEvents && liveEvents.length)
    ) {
      await updateLiveMessage(channel, liveEvents);
    } else if (!liveEvents.length) {
      const oldLive = await findLiveMessages(channel);

      for (const message of oldLive) {
        try {
          await message.delete();
        } catch {}
      }
    }

    previousEvents = events;

    console.log(
      "[SCHEDULE] Updated successfully at " +
      DateTime.now().setZone(TIMEZONE).toFormat("HH:mm:ss")
    );
  } catch (error) {
    console.error("[SCHEDULE] UPDATE FAILED:", error.message);
  }
}

client.once("ready", async () => {
  console.log("Logged in as " + client.user.tag);
  console.log("Using channel ID: " + CHANNEL_ID);

  if (!CHANNEL_ID) {
    console.error("DISCORD_CHANNEL_ID is missing.");
    return;
  }

  await updateSchedule();

  setInterval(updateSchedule, 60 * 1000);
});

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("DISCORD_CHANNEL_ID is missing.");
  process.exit(1);
}

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
});
