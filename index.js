const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000; // 60 seconds
const EVENT_WINDOW = 48 * 60 * 60 * 1000; // 48 hours

const CATEGORIES = [
  "football",
  "tennis",
  "basketball",
  "fights",
  "motorsports",
  "americanfootball",
  "nhl",
  "mlb",
  "rugby",
  "golf",
  "others",
  "wrestling",
  "darts"
];

const EVENTS_LINK =
  "https://discord.com/channels/1372972743464714370/1455146521975586878/1541192756104273923";

const REQUEST_LINK =
  "https://discord.com/channels/1372972743464714370/1455147734544941162";

const API_BASE = "https://futbol-x.xyz/api";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --------------------------------------------------
// STATE
// --------------------------------------------------

let previousEvents = null;

let scheduleMessage = null;
let liveMessage = null;

// --------------------------------------------------
// TIME
// --------------------------------------------------

function parseEAT(dateString) {
  return DateTime.fromISO(dateString, {
    zone: "Africa/Nairobi"
  });
}

// --------------------------------------------------
// FETCH EVENTS
// --------------------------------------------------

async function fetchCategory(category) {
  try {
    const response = await fetch(`${API_BASE}/${category}.json`);

    if (!response.ok) {
      console.error(`Failed to fetch ${category}: ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.streams)) {
      return [];
    }

    const events = [];

    for (const group of data.streams) {
      if (!Array.isArray(group.streams)) continue;

      for (const event of group.streams) {
        if (!event.name || !event.starts_at || !event.ends_at) continue;

        events.push({
          category,
          name: event.name,
          starts_at: event.starts_at,
          ends_at: event.ends_at
        });
      }
    }

    return events;
  } catch (error) {
    console.error(`Error fetching ${category}:`, error.message);
    return [];
  }
}

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category => fetchCategory(category))
  );

  return results.flat();
}

// --------------------------------------------------
// EVENT KEY
// --------------------------------------------------

function eventKey(event) {
  return [
    event.category,
    event.name,
    event.starts_at,
    event.ends_at
  ].join("|");
}

// --------------------------------------------------
// EVENT FILTERING
// --------------------------------------------------

function processEvents(events) {
  const now = DateTime.now().setZone("Africa/Nairobi");

  const filtered = [];

  for (const event of events) {
    const start = parseEAT(event.starts_at);
    const end = parseEAT(event.ends_at);

    if (!start.isValid || !end.isValid) continue;

    const isLive = now >= start && now < end;

    const startsWithin48Hours =
      start > now &&
      start <= now.plus({ milliseconds: EVENT_WINDOW });

    if (isLive || startsWithin48Hours) {
      filtered.push({
        ...event,
        start,
        end,
        isLive
      });
    }
  }

  filtered.sort(
    (a, b) => a.start.toMillis() - b.start.toMillis()
  );

  return filtered;
}

// --------------------------------------------------
// TIME DISPLAY
// --------------------------------------------------

function formatEventTime(event) {
  const now = DateTime.now().setZone("Africa/Nairobi");

  const diffMs = event.start.toMillis() - now.toMillis();

  if (diffMs <= 0) {
    return "LIVE";
  }

  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));

  // More than 24 hours
  if (totalHours >= 24) {
    const days = Math.ceil(totalHours / 24);

    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }

  // Less than 24 hours
  const hours = Math.max(1, totalHours);

  return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

// --------------------------------------------------
// BUILD UPCOMING SCHEDULE
// --------------------------------------------------

function buildScheduleMessage(events) {
  let message = "";

  message += "━━━━━━━━━━━━━━━━━━━━\n";
  message += "**FUTBOL-X**\n";
  message += "**LIVE & UPCOMING**\n";
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

  // Group upcoming events
  const grouped = {};

  for (const event of events) {
    if (event.isLive) continue;

    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }

    grouped[event.category].push(event);
  }

  let categoryCount = 0;

  for (const category of CATEGORIES) {
    const categoryEvents = grouped[category];

    if (!categoryEvents || categoryEvents.length === 0) {
      continue;
    }

    if (categoryCount > 0) {
      message += "\n";
    }

    message += `${categoryEmoji(category)} **${category.toUpperCase()}**\n`;

    for (const event of categoryEvents) {
      const time = event.start.toFormat("h:mm a");
      const countdown = formatEventTime(event);

      message += `• **${event.name}** — ${time} (${countdown})\n`;
    }

    categoryCount++;
  }

  if (categoryCount === 0) {
    message += "*No upcoming events.*\n";
  }

  return message.trim();
}

// --------------------------------------------------
// BUILD LIVE MESSAGE
// --------------------------------------------------

function buildLiveMessage(liveEvents) {
  let message = "";

  message += "🔴 **LIVE NOW**\n\n";

  for (const event of liveEvents) {
    message += `⚽ **${event.name}**\n`;
    message += "🔴 LIVE\n\n";
  }

  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

  message += `🔗 **Events Links Here;**\n`;
  message += `${EVENTS_LINK}\n\n`;

  message += `📝 **Event Request Here;**\n`;
  message += `${REQUEST_LINK}`;

  return message.trim();
}

// --------------------------------------------------
// CATEGORY EMOJIS
// --------------------------------------------------

function categoryEmoji(category) {
  const emojis = {
    football: "⚽",
    tennis: "🎾",
    basketball: "🏀",
    fights: "🥊",
    motorsports: "🏎️",
    nfl: "🏈",
    nhl: "🏒",
    mlb: "⚾",
    rugby: "🏉",
    golf: "⛳",
    others: "📺",
    wrestling: "🤼",
    darts: "🎯"
  };

  return emojis[category] || "📺";
}

// --------------------------------------------------
// FIND EXISTING SCHEDULE MESSAGE
// --------------------------------------------------

async function findScheduleMessage(channel) {
  const messages = await channel.messages.fetch({
    limit: 50
  });

  return messages.find(message =>
    message.author.id === client.user.id &&
    message.content.includes("FUTBOL-X") &&
    message.content.includes("LIVE & UPCOMING")
  );
}

// --------------------------------------------------
// FIND EXISTING LIVE MESSAGE
// --------------------------------------------------

async function findLiveMessage(channel) {
  const messages = await channel.messages.fetch({
    limit: 50
  });

  return messages.find(message =>
    message.author.id === client.user.id &&
    message.content.includes("🔴 **LIVE NOW**") &&
    message.content.includes("Events Links Here")
  );
}

// --------------------------------------------------
// GET / CREATE SCHEDULE MESSAGE
// --------------------------------------------------

async function getScheduleMessage(channel) {
  if (scheduleMessage) {
    try {
      await scheduleMessage.fetch();
      return scheduleMessage;
    } catch {
      scheduleMessage = null;
    }
  }

  const existing = await findScheduleMessage(channel);

  if (existing) {
    scheduleMessage = existing;
    return existing;
  }

  scheduleMessage = await channel.send("Loading Futbol-X schedule...");

  return scheduleMessage;
}

// --------------------------------------------------
// UPDATE LIVE MESSAGE
// --------------------------------------------------

async function updateLiveMessage(channel, liveEvents) {
  // ------------------------------------------------
  // NO LIVE EVENTS
  // ------------------------------------------------

  if (liveEvents.length === 0) {
    if (liveMessage) {
      try {
        await liveMessage.delete();
      } catch {}

      liveMessage = null;
    }

    // Also remove an old live message if the bot
    // restarted and doesn't have it in memory.
    const existing = await findLiveMessage(channel);

    if (existing) {
      try {
        await existing.delete();
      } catch {}
    }

    return;
  }

  // ------------------------------------------------
  // THERE ARE LIVE EVENTS
  // ------------------------------------------------

  const content = buildLiveMessage(liveEvents);

  // If we already have the live message, update it
  // normally without creating another one.
  if (liveMessage) {
    try {
      await liveMessage.fetch();
      await liveMessage.edit(content);
      return;
    } catch {
      liveMessage = null;
    }
  }

  // Look for an existing one after restart.
  const existing = await findLiveMessage(channel);

  if (existing) {
    liveMessage = existing;

    await liveMessage.edit(content);

    return;
  }

  // Send a NEW message.
  // This makes Discord show the channel as having
  // a new message.
  liveMessage = await channel.send(content);
}

// --------------------------------------------------
// DETECT IMPORTANT CHANGES
// --------------------------------------------------

function detectImportantChange(currentEvents) {
  if (!previousEvents) {
    return false;
  }

  const previousKeys = new Set(
    previousEvents.map(eventKey)
  );

  const currentKeys = new Set(
    currentEvents.map(eventKey)
  );

  // -----------------------------------------------
  // NEW EVENTS ADDED
  // -----------------------------------------------

  for (const event of currentEvents) {
    if (!previousKeys.has(eventKey(event))) {
      return true;
    }
  }

  // -----------------------------------------------
  // EVENT JUST WENT LIVE
  // -----------------------------------------------

  const previousLive = new Set(
    previousEvents
      .filter(event => event.isLive)
      .map(eventKey)
  );

  const currentLive = currentEvents.filter(
    event => event.isLive
  );

  for (const event of currentLive) {
    if (!previousLive.has(eventKey(event))) {
      return true;
    }
  }

  return false;
}

// --------------------------------------------------
// DELETE + SEND LIVE/UPDATE MESSAGE
// --------------------------------------------------

async function recreateLiveMessage(channel, liveEvents) {
  // Delete current live/update message
  if (liveMessage) {
    try {
      await liveMessage.delete();
    } catch {}

    liveMessage = null;
  }

  // Also find one left behind after a restart
  const existing = await findLiveMessage(channel);

  if (existing) {
    try {
      await existing.delete();
    } catch {}
  }

  // If there are live events, send the LIVE message.
  // This will be the newest message in the channel.
  if (liveEvents.length > 0) {
    liveMessage = await channel.send(
      buildLiveMessage(liveEvents)
    );
  }
}

// --------------------------------------------------
// UPDATE
// --------------------------------------------------

async function updateSchedule() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error("Configured channel is not a text channel.");
      return;
    }

    const allEvents = await fetchAllEvents();
    const events = processEvents(allEvents);

    const liveEvents = events.filter(
      event => event.isLive
    );

    const importantChange = detectImportantChange(events);

    // -----------------------------------------------
    // MAIN SCHEDULE
    // -----------------------------------------------

    const content = buildScheduleMessage(events);

    const message = await getScheduleMessage(channel);

    await message.edit(content);

    // -----------------------------------------------
    // LIVE / NEW EVENT MESSAGE
    // -----------------------------------------------

    if (importantChange) {
      // Something important changed.
      //
      // Delete old LIVE message and create a fresh
      // one so Discord treats it as a new message.
      await recreateLiveMessage(
        channel,
        liveEvents
      );

      console.log(
        "Important schedule change detected."
      );
    } else {
      // No new event and nothing newly live.
      //
      // Make sure LIVE message still exists if
      // there are live events.
      await updateLiveMessage(
        channel,
        liveEvents
      );
    }

    // -----------------------------------------------
    // SAVE CURRENT STATE
    // -----------------------------------------------

    previousEvents = events;

    console.log(
      `Schedule checked: ${events.length} events (${new Date().toISOString()})`
    );

  } catch (error) {
    console.error(
      "Schedule update error:",
      error
    );
  }
}

// --------------------------------------------------
// START
// --------------------------------------------------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await updateSchedule();

  setInterval(
    updateSchedule,
    POLL_INTERVAL
  );
});

// --------------------------------------------------
// ENVIRONMENT VARIABLES
// --------------------------------------------------

if (!TOKEN) {
  console.error(
    "Missing DISCORD_TOKEN environment variable."
  );

  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error(
    "Missing DISCORD_CHANNEL_ID environment variable."
  );

  process.exit(1);
}

client.login(TOKEN);
