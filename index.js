const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

const { DateTime } = require("luxon");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

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
let scheduleMessages = [];

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
    const response = await fetch(`${API_BASE}/${category}.json`);

    if (!response.ok) {
      throw new Error(
        `${category}: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data.events)) {
      return data.events;
    }

    return [];
  } catch (error) {
    console.error(`Failed to fetch ${category}:`, error.message);
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

function eventKey(event) {
  return [
    event.category,
    event.name,
    event.starts_at,
    event.ends_at
  ].join("|");
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
        (!end || !end.isValid || now <= end);

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
  const maxTime = now.plus({ hours: 48 });

  return events.filter(event => {
    if (!event.start || !event.start.isValid) {
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
  const diff = start.diff(now, ["days", "hours", "minutes"]).toObject();

  const totalMinutes = Math.max(
    0,
    Math.round(start.diff(now, "minutes").minutes)
  );

  if (totalMinutes < 1) {
    return "starting now";
  }

  if (totalMinutes < 60) {
    return `in ${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const totalHours = Math.floor(totalMinutes / 60);

  if (totalHours < 24) {
    return `in ${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  }

  const totalDays = Math.floor(totalHours / 24);

  return `in ${totalDays} day${totalDays === 1 ? "" : "s"}`;
}

function buildCategoryEmbeds(events) {
  const now = DateTime.now().setZone(TIMEZONE);
  const checkedAt = now.toFormat("HH:mm");

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

  const categoryEmbeds = [];

  for (const category of CATEGORIES) {
    const categoryEvents = grouped[category];

    if (!categoryEvents.length) {
      continue;
    }

    categoryEvents.sort(
      (a, b) => a.start.toMillis() - b.start.toMillis()
    );

    const lines = categoryEvents.map(event => {
      const time = event.start.toFormat("h:mm a");
      const countdown = formatCountdown(event.start);

      return `• **${event.name}** — **${time}** (${countdown})`;
    });

    const embed = new EmbedBuilder()
      .setTitle(
        `${categoryEmoji(category)} ${category.toUpperCase()}`
      )
      .setDescription(lines.join("\n"))
      .setFooter({
        text: `Today at ${checkedAt}`
      });

    categoryEmbeds.push({
      category,
      embed
    });
  }

  return categoryEmbeds;
}

function isScheduleMessage(message) {
  if (
    !message ||
    !client.user ||
    message.author?.id !== client.user.id
  ) {
    return false;
  }

  const content = String(message.content ?? "");

  if (
    content.includes("LIVE & UPCOMING") ||
    content.includes("FUTBOL-X • SCHEDULE CONTINUED")
  ) {
    return true;
  }

  const firstLine = content.split("\n")[0].trim();

  for (const category of CATEGORIES) {
    const normal =
      `${categoryEmoji(category)} **${category.toUpperCase()}**`;

    const continued =
      `${categoryEmoji(category)} **${category.toUpperCase()} — CONTINUED**`;

    if (
      firstLine === normal ||
      firstLine === continued
    ) {
      return true;
    }
  }

  if (
    Array.isArray(message.embeds) &&
    message.embeds.length
  ) {
    const title = message.embeds[0]?.title || "";

    return CATEGORIES.some(category => {
      const normal =
        `${categoryEmoji(category)} ${category.toUpperCase()}`;

      const continued =
        `${categoryEmoji(category)} ${category.toUpperCase()} — CONTINUED`;

      return (
        title === normal ||
        title.startsWith(continued)
      );
    });
  }

  return false;
}

function getScheduleMessageCategory(message) {
  if (!message) {
    return null;
  }

  const content = String(message.content ?? "");
  const firstLine = content.split("\n")[0].trim();

  for (const category of CATEGORIES) {
    const normal =
      `${categoryEmoji(category)} **${category.toUpperCase()}**`;

    const continued =
      `${categoryEmoji(category)} **${category.toUpperCase()} — CONTINUED**`;

    if (
      firstLine === normal ||
      firstLine === continued
    ) {
      return category;
    }
  }

  if (
    Array.isArray(message.embeds) &&
    message.embeds.length
  ) {
    const title = message.embeds[0]?.title || "";

    for (const category of CATEGORIES) {
      const normal =
        `${categoryEmoji(category)} ${category.toUpperCase()}`;

      const continued =
        `${categoryEmoji(category)} ${category.toUpperCase()} — CONTINUED`;

      if (
        title === normal ||
        title.startsWith(continued)
      ) {
        return category;
      }
    }
  }

  return null;
}

async function findScheduleMessages(channel) {
  const messages = [];

  let lastId;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {})
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

    lastId = fetched.last().id;
  }

  return messages;
}

async function updateScheduleMessages(channel, categoryEmbeds) {
  const existing = await findScheduleMessages(channel);

  const groupedExisting = {};

  for (const message of existing) {
    const category = getScheduleMessageCategory(message);

    if (!category) {
      continue;
    }

    if (!groupedExisting[category]) {
      groupedExisting[category] = [];
    }

    groupedExisting[category].push(message);
  }

  const existingByCategory = new Map();

  for (const category of CATEGORIES) {
    const messages = groupedExisting[category];

    if (!messages || !messages.length) {
      continue;
    }

    messages.sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    existingByCategory.set(
      category,
      messages[0]
    );
  }

  const usedMessageIds = new Set();
  const updatedMessages = [];

  let createdScheduleMessage = false;

  for (const item of categoryEmbeds) {
    const existingMessage =
      existingByCategory.get(item.category);

    if (existingMessage) {
      await existingMessage.edit({
        content: "",
        embeds: [item.embed]
      });

      usedMessageIds.add(existingMessage.id);
      updatedMessages.push(existingMessage);
    } else {
      const newMessage = await channel.send({
        content: "",
        embeds: [item.embed]
      });

      usedMessageIds.add(newMessage.id);
      updatedMessages.push(newMessage);

      createdScheduleMessage = true;
    }
  }

  for (const message of existing) {
    if (!usedMessageIds.has(message.id)) {
      try {
        await message.delete();
      } catch (error) {
        console.error(
          "Failed to delete old schedule message:",
          error.message
        );
      }
    }
  }

  scheduleMessages = updatedMessages;

  return createdScheduleMessage;
}

function isActivityMessage(message) {
  if (
    !message ||
    !client.user ||
    message.author?.id !== client.user.id
  ) {
    return false;
  }

  const content = String(message.content ?? "");

  return (
    content.includes("🔴 LIVE NOW") ||
    content.includes("🟢 LIVE") ||
    content.includes("LIVE & UPCOMING")
  );
}

async function findActivityMessages(channel) {
  const messages = [];

  let lastId;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {})
    });

    if (!fetched.size) {
      break;
    }

    for (const message of fetched.values()) {
      if (isActivityMessage(message)) {
        messages.push(message);
      }
    }

    if (fetched.size < 100) {
      break;
    }

    lastId = fetched.last().id;
  }

  return messages;
}

async function deleteActivityMessage(channel) {
  const messages = await findActivityMessages(channel);

  for (const message of messages) {
    try {
      await message.delete();
    } catch (error) {
      console.error(
        "Failed to delete activity message:",
        error.message
      );
    }
  }
}

function buildLiveMessage(liveEvents) {
  if (!liveEvents.length) {
    return null;
  }

  const lines = liveEvents
    .sort(
      (a, b) => a.start.toMillis() - b.start.toMillis()
    )
    .map(event => {
      return `🔴 **${event.name}**`;
    });

  return [
    "🔴 **LIVE NOW**",
    "",
    lines.join("\n")
  ].join("\n");
}

async function sendLiveMessage(channel, liveEvents) {
  await deleteActivityMessage(channel);

  if (!liveEvents.length) {
    return;
  }

  const content = buildLiveMessage(liveEvents);

  if (!content) {
    return;
  }

  await channel.send({
    content
  });
}

function detectChanges(oldEvents, newEvents) {
  if (!oldEvents) {
    return {
      newEvents: [],
      newlyLive: [],
      endedLive: []
    };
  }

  const oldMap = new Map(
    oldEvents.map(event => [
      eventKey(event),
      event
    ])
  );

  const newMap = new Map(
    newEvents.map(event => [
      eventKey(event),
      event
    ])
  );

  const newEventsFound = [];
  const newlyLive = [];
  const endedLive = [];

  for (const event of newEvents) {
    const key = eventKey(event);
    const oldEvent = oldMap.get(key);

    if (!oldEvent) {
      newEventsFound.push(event);

      if (event.isLive) {
        newlyLive.push(event);
      }

      continue;
    }

    if (!oldEvent.isLive && event.isLive) {
      newlyLive.push(event);
    }
  }

  for (const oldEvent of oldEvents) {
    const key = eventKey(oldEvent);
    const currentEvent = newMap.get(key);

    if (
      oldEvent.isLive &&
      (!currentEvent || !currentEvent.isLive)
    ) {
      endedLive.push(oldEvent);
    }
  }

  return {
    newEvents: newEventsFound,
    newlyLive,
    endedLive
  };
}

async function ensureLiveMessage(
  channel,
  liveEvents,
  forceNew = false
) {
  const activityMessages =
    await findActivityMessages(channel);

  if (forceNew) {
    await deleteActivityMessage(channel);

    if (liveEvents.length) {
      await sendLiveMessage(channel, liveEvents);
    }

    return;
  }

  if (!liveEvents.length) {
    if (activityMessages.length) {
      await deleteActivityMessage(channel);
    }

    return;
  }

  if (!activityMessages.length) {
    await sendLiveMessage(channel, liveEvents);
  }
}

async function updateSchedule() {
  try {
    const channel =
      await client.channels.fetch(CHANNEL_ID);

    if (!channel) {
      console.error("Schedule channel not found.");
      return;
    }

    const rawEvents =
      await fetchAllEvents();

    const events =
      processEvents(rawEvents);

    const liveEvents =
      events.filter(event => event.isLive);

    const upcomingEvents =
      getUpcomingEvents(events);

    const {
      newlyLive,
      endedLive
    } = detectChanges(
      previousEvents,
      events
    );

    /*
     * Schedule messages are handled entirely here.
     *
     * Existing category:
     *   edit the same message.
     *
     * New category:
     *   create one new message.
     *
     * Empty category:
     *   delete its old message.
     */
    await updateScheduleMessages(
      channel,
      buildCategoryEmbeds(upcomingEvents)
    );

    /*
     * Live activity remains separate from the schedule.
     */
    if (newlyLive.length) {
      await sendLiveMessage(
        channel,
        liveEvents
      );
    } else if (endedLive.length) {
      await sendLiveMessage(
        channel,
        liveEvents
      );
    } else {
      await ensureLiveMessage(
        channel,
        liveEvents,
        false
      );
    }

    previousEvents = events;

    console.log(
      `[${DateTime.now()
        .setZone(TIMEZONE)
        .toFormat("yyyy-MM-dd HH:mm:ss")}] Schedule updated`
    );
  } catch (error) {
    console.error(
      "Failed to update schedule:",
      error
    );
  }
}

client.once("clientReady", async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  await updateSchedule();

  setInterval(
    updateSchedule,
    60 * 1000
  );
});

if (!TOKEN) {
  console.error(
    "Missing DISCORD_TOKEN environment variable."
  );
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error(
    "Missing CHANNEL_ID environment variable."
  );
  process.exit(1);
}

client.login(TOKEN);
