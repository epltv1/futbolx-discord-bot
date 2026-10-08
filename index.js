const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000;
const EVENT_WINDOW = 48 * 60 * 60 * 1000;

const SCHEDULE_MAX_LENGTH = 1900;

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

const EVENTS_LINK =
  "https://discord.com/channels/1372972743464714370/1455146521975586878/1541192756104273923";

const REQUEST_LINK =
  "https://discord.com/channels/1372972743464714370/1455147734544941162";

const API_BASE =
  "https://www.futbol-x.xyz/api";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let previousEvents = null;
let scheduleMessages = [];
let activityMessage = null;

function parseEAT(dateString) {
  return DateTime.fromISO(dateString, {
    zone: "Africa/Nairobi"
  });
}

function categoryEmoji(category) {
  const emojis = {
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

  return emojis[category] || "📺";
}

async function fetchCategory(category) {
  try {
    const response = await fetch(
      `${API_BASE}/${category}.json`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (
      !data.success ||
      !Array.isArray(data.streams)
    ) {
      return [];
    }

    const events = [];

    for (const group of data.streams) {
      if (
        !group ||
        !Array.isArray(group.streams)
      ) {
        continue;
      }

      for (const stream of group.streams) {
        if (
          !stream ||
          !stream.name ||
          !stream.starts_at ||
          !stream.ends_at
        ) {
          continue;
        }

        events.push({
          category,
          name: stream.name,
          starts_at: stream.starts_at,
          ends_at: stream.ends_at
        });
      }
    }

    return events;
  } catch (error) {
    console.error(
      `Failed to fetch ${category}:`,
      error.message
    );

    return [];
  }
}

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category =>
      fetchCategory(category)
    )
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

function processEvents(rawEvents) {
  const now =
    DateTime.now().setZone("Africa/Nairobi");

  const windowEnd = now.plus({
    milliseconds: EVENT_WINDOW
  });

  const events = [];

  for (const event of rawEvents) {
    const start =
      parseEAT(event.starts_at);

    const end =
      parseEAT(event.ends_at);

    if (!start.isValid || !end.isValid) {
      continue;
    }

    const isLive =
      now >= start &&
      now < end;

    const isUpcoming =
      start > now &&
      start <= windowEnd;

    if (!isLive && !isUpcoming) {
      continue;
    }

    events.push({
      ...event,
      start,
      end,
      isLive
    });
  }

  events.sort(
    (a, b) =>
      a.start.toMillis() -
      b.start.toMillis()
  );

  return events;
}

function getUpcomingEvents(events) {
  return events
    .filter(event => !event.isLive)
    .sort(
      (a, b) =>
        a.start.toMillis() -
        b.start.toMillis()
    );
}

function formatCountdown(start) {
  const now =
    DateTime.now().setZone("Africa/Nairobi");

  const diffMs =
    start.toMillis() -
    now.toMillis();

  if (diffMs <= 0) {
    return "LIVE";
  }

  const totalMinutes =
    Math.floor(
      diffMs / (60 * 1000)
    );

  const minutesSafe =
    Math.max(1, totalMinutes);

  if (minutesSafe >= 24 * 60) {
    const days =
      Math.ceil(
        minutesSafe / (24 * 60)
      );

    return `in ${days} ${
      days === 1 ? "day" : "days"
    }`;
  }

  const hours =
    Math.floor(minutesSafe / 60);

  if (hours >= 1) {
    return `in ${hours} ${
      hours === 1 ? "hour" : "hours"
    }`;
  }

  return `in ${minutesSafe} ${
    minutesSafe === 1
      ? "minute"
      : "minutes"
  }`;
}

function buildCategoryMessages(events) {
  const now =
    DateTime.now().setZone(
      "Africa/Nairobi"
    );

  const checkedAt =
    now.toFormat("HH:mm");

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

  const messages = [];

  for (const category of CATEGORIES) {
    const categoryEvents =
      grouped[category];

    if (!categoryEvents.length) {
      continue;
    }

    categoryEvents.sort(
      (a, b) =>
        a.start.toMillis() -
        b.start.toMillis()
    );

    const emoji =
      categoryEmoji(category);

    const title =
      category.toUpperCase();

    let messageNumber = 1;

    let currentLines = [
      `${emoji} **${title}**`,
      ""
    ];

    for (const event of categoryEvents) {
      const time =
        event.start.toFormat("h:mm a");

      const countdown =
        formatCountdown(event.start);

      const eventLine =
        `• **${event.name}** — **${time}** (${countdown})`;

      const candidate = [
        ...currentLines,
        eventLine,
        "",
        `Today at ${checkedAt}`
      ].join("\n");

      if (
        candidate.length <=
        SCHEDULE_MAX_LENGTH
      ) {
        currentLines.push(eventLine);
        continue;
      }

      currentLines.push(
        "",
        `Today at ${checkedAt}`
      );

      messages.push({
        category,
        messageNumber,
        content:
          currentLines.join("\n")
      });

      messageNumber++;

      currentLines = [
        `${emoji} **${title} — CONTINUED**`,
        "",
        eventLine
      ];
    }

    currentLines.push(
      "",
      `Today at ${checkedAt}`
    );

    messages.push({
      category,
      messageNumber,
      content:
        currentLines.join("\n")
    });
  }

  return messages;
}

function isScheduleMessage(message) {
  if (
    !message ||
    !client.user ||
    message.author?.id !==
      client.user.id
  ) {
    return false;
  }

  const content =
    String(message.content ?? "");

  if (
    content.includes("LIVE & UPCOMING") ||
    content.includes(
      "FUTBOL-X • SCHEDULE CONTINUED"
    )
  ) {
    return true;
  }

  const firstLine =
    content
      .split("\n")[0]
      .trim();

  return CATEGORIES.some(
    category => {
      const normal =
        `${categoryEmoji(category)} **${category.toUpperCase()}**`;

      const continued =
        `${categoryEmoji(category)} **${category.toUpperCase()} — CONTINUED**`;

      return (
        firstLine === normal ||
        firstLine === continued
      );
    }
  );
}

function getScheduleMessageCategory(
  message
) {
  const content =
    String(message?.content ?? "");

  const firstLine =
    content
      .split("\n")[0]
      .trim();

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

  return null;
}

async function findScheduleMessages(
  channel
) {
  const fetched =
    await channel.messages.fetch({
      limit: 100
    });

  return fetched
    .filter(message =>
      isScheduleMessage(message)
    )
    .sort(
      (a, b) =>
        a.createdTimestamp -
        b.createdTimestamp
    );
}

async function updateScheduleMessages(
  channel,
  categoryMessages
) {
  const existing =
    await findScheduleMessages(
      channel
    );

  const groupedExisting = {};

  for (const message of existing) {
    const category =
      getScheduleMessageCategory(
        message
      );

    if (!category) {
      continue;
    }

    if (!groupedExisting[category]) {
      groupedExisting[category] = [];
    }

    groupedExisting[category].push(
      message
    );
  }

  const existingByKey =
    new Map();

  for (const category of CATEGORIES) {
    if (!groupedExisting[category]) {
      continue;
    }

    groupedExisting[category].sort(
      (a, b) =>
        a.createdTimestamp -
        b.createdTimestamp
    );

    groupedExisting[category].forEach(
      (message, index) => {
        existingByKey.set(
          `${category}:${index + 1}`,
          message
        );
      }
    );
  }

  const usedMessageIds =
    new Set();

  const updatedMessages = [];

  let createdScheduleMessage =
    false;

  for (const item of categoryMessages) {
    const key =
      `${item.category}:${item.messageNumber}`;

    const existingMessage =
      existingByKey.get(key);

    if (existingMessage) {
      if (
        existingMessage.content !==
        item.content
      ) {
        await existingMessage.edit(
          item.content
        );
      }

      usedMessageIds.add(
        existingMessage.id
      );

      updatedMessages.push(
        existingMessage
      );
    } else {
      const newMessage =
        await channel.send(
          item.content
        );

      usedMessageIds.add(
        newMessage.id
      );

      updatedMessages.push(
        newMessage
      );

      createdScheduleMessage =
        true;
    }
  }

  for (const message of existing) {
    if (
      !usedMessageIds.has(
        message.id
      )
    ) {
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

  scheduleMessages =
    updatedMessages;

  return createdScheduleMessage;
}

function isActivityMessage(message) {
  if (
    !message ||
    !client.user ||
    message.author?.id !==
      client.user.id
  ) {
    return false;
  }

  const content =
    String(message.content ?? "");

  return (
    content.includes(
      "🔴 **LIVE NOW**"
    ) ||
    content.includes(
      "🔔 **Schedule updated**"
    )
  );
}

async function findActivityMessages(
  channel
) {
  const fetched =
    await channel.messages.fetch({
      limit: 100
    });

  return fetched
    .filter(message =>
      isActivityMessage(message)
    )
    .sort(
      (a, b) =>
        b.createdTimestamp -
        a.createdTimestamp
    );
}

async function deleteActivityMessage(
  channel
) {
  const messages =
    await findActivityMessages(
      channel
    );

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

  activityMessage = null;
}

function buildLiveMessage(
  liveEvents
) {
  const lines = [
    "🔴 **LIVE NOW**",
    ""
  ];

  for (const event of liveEvents) {
    lines.push(
      `${categoryEmoji(event.category)} **${event.name}**`,
      "🔴 LIVE",
      ""
    );
  }

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔗 **Events Links Here;**",
    EVENTS_LINK,
    "",
    "📝 **Event Request Here;**",
    REQUEST_LINK
  );

  return lines.join("\n");
}

async function sendLiveMessage(
  channel,
  liveEvents
) {
  await deleteActivityMessage(
    channel
  );

  if (!liveEvents.length) {
    return;
  }

  const content =
    buildLiveMessage(
      liveEvents
    );

  activityMessage =
    await channel.send(content);
}

function buildUpdateMessage(
  newEvents
) {
  if (newEvents.length === 1) {
    return [
      "🔔 **Schedule updated**",
      `New event added: **${newEvents[0].name}**`
    ].join("\n");
  }

  if (newEvents.length > 1) {
    return [
      "🔔 **Schedule updated**",
      `${newEvents.length} new events added.`
    ].join("\n");
  }

  return "🔔 **Schedule updated**";
}

async function sendUpdateNotification(
  channel,
  newEvents
) {
  await deleteActivityMessage(
    channel
  );

  const content =
    buildUpdateMessage(
      newEvents
    );

  activityMessage =
    await channel.send(content);
}

function detectChanges(
  previous,
  current
) {
  if (!previous) {
    return {
      newEvents: [],
      newlyLive: [],
      endedLive: []
    };
  }

  const previousMap =
    new Map(
      previous.map(event => [
        eventKey(event),
        event
      ])
    );

  const currentMap =
    new Map(
      current.map(event => [
        eventKey(event),
        event
      ])
    );

  const newEvents = [];
  const newlyLive = [];
  const endedLive = [];

  for (const event of current) {
    const key =
      eventKey(event);

    const oldEvent =
      previousMap.get(key);

    if (!oldEvent) {
      newEvents.push(event);

      if (event.isLive) {
        newlyLive.push(event);
      }

      continue;
    }

    if (
      !oldEvent.isLive &&
      event.isLive
    ) {
      newlyLive.push(event);
    }
  }

  for (const oldEvent of previous) {
    const key =
      eventKey(oldEvent);

    if (
      oldEvent.isLive &&
      !currentMap.has(key)
    ) {
      endedLive.push(oldEvent);
    }
  }

  return {
    newEvents,
    newlyLive,
    endedLive
  };
}

async function ensureLiveMessage(
  channel,
  liveEvents,
  forceNew = false
) {
  if (!liveEvents.length) {
    await deleteActivityMessage(
      channel
    );

    return;
  }

  const existing =
    await findActivityMessages(
      channel
    );

  const liveMessage =
    existing.find(message =>
      String(
        message.content ?? ""
      ).includes(
        "🔴 **LIVE NOW**"
      )
    );

  if (
    forceNew ||
    !liveMessage
  ) {
    await sendLiveMessage(
      channel,
      liveEvents
    );

    return;
  }

  activityMessage =
    liveMessage;

  for (const message of existing) {
    if (
      message.id !==
      liveMessage.id
    ) {
      try {
        await message.delete();
      } catch {}
    }
  }
}

async function updateSchedule() {
  try {
    const channel =
      await client.channels.fetch(
        CHANNEL_ID
      );

    if (!channel) {
      console.error(
        "Discord channel not found."
      );

      return;
    }

    const rawEvents =
      await fetchAllEvents();

    const events =
      processEvents(
        rawEvents
      );

    const liveEvents =
      events.filter(
        event => event.isLive
      );

    const upcomingEvents =
      getUpcomingEvents(
        events
      );

    const {
      newEvents,
      newlyLive,
      endedLive
    } = detectChanges(
      previousEvents,
      events
    );

    const categoryMessages =
      buildCategoryMessages(
        upcomingEvents
      );

    const createdScheduleMessage =
      await updateScheduleMessages(
        channel,
        categoryMessages
      );

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
    } else if (newEvents.length) {
      const hasNewLive =
        newEvents.some(
          event => event.isLive
        );

      if (hasNewLive) {
        await sendLiveMessage(
          channel,
          liveEvents
        );
      } else {
        await sendUpdateNotification(
          channel,
          newEvents
        );
      }
    } else {
      await ensureLiveMessage(
        channel,
        liveEvents,
        createdScheduleMessage
      );
    }

    previousEvents = events;

    console.log(
      `[${DateTime.now()
        .setZone("Africa/Nairobi")
        .toFormat(
          "yyyy-MM-dd HH:mm:ss"
        )}] ` +
      `Schedule updated | ` +
      `Live: ${liveEvents.length} | ` +
      `Upcoming: ${upcomingEvents.length}`
    );
  } catch (error) {
    console.error(
      "Schedule update failed:",
      error
    );
  }
}

client.once(
  "clientReady",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    await updateSchedule();

    setInterval(
      updateSchedule,
      POLL_INTERVAL
    );
  }
);

if (!TOKEN) {
  console.error(
    "DISCORD_TOKEN is missing."
  );

  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error(
    "DISCORD_CHANNEL_ID is missing."
  );

  process.exit(1);
}

client.login(TOKEN);
