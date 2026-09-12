const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000;
const EVENT_WINDOW = 48 * 60 * 60 * 1000;

// Keep safely below Discord's 2000 character limit.
const MAX_MESSAGE_LENGTH = 1900;

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

const API_BASE = "https://futbol-x.xyz/api";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --------------------------------------------------
// STATE
// --------------------------------------------------

let previousEvents = null;

// Main schedule can now contain multiple messages.
let scheduleMessages = [];

let activityMessage = null;

// --------------------------------------------------
// TIME
// --------------------------------------------------

function parseEAT(dateString) {
  return DateTime.fromISO(dateString, {
    zone: "Africa/Nairobi"
  });
}

// --------------------------------------------------
// FETCH CATEGORY
// --------------------------------------------------

async function fetchCategory(category) {
  try {
    const response = await fetch(
      `${API_BASE}/${category}.json`
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch ${category}: ${response.status}`
      );

      return [];
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
      if (!Array.isArray(group.streams)) {
        continue;
      }

      for (const event of group.streams) {
        if (
          !event.name ||
          !event.starts_at ||
          !event.ends_at
        ) {
          continue;
        }

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
    console.error(
      `Error fetching ${category}:`,
      error.message
    );

    return [];
  }
}

// --------------------------------------------------
// FETCH EVERYTHING
// --------------------------------------------------

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category =>
      fetchCategory(category)
    )
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
// PROCESS EVENTS
// --------------------------------------------------

function processEvents(events) {
  const now = DateTime.now().setZone(
    "Africa/Nairobi"
  );

  const filtered = [];

  for (const event of events) {
    const start = parseEAT(
      event.starts_at
    );

    const end = parseEAT(
      event.ends_at
    );

    if (
      !start.isValid ||
      !end.isValid
    ) {
      continue;
    }

    const isLive =
      now >= start &&
      now < end;

    const startsWithin48Hours =
      start > now &&
      start <= now.plus({
        milliseconds: EVENT_WINDOW
      });

    if (
      isLive ||
      startsWithin48Hours
    ) {
      filtered.push({
        ...event,
        start,
        end,
        isLive
      });
    }
  }

  filtered.sort(
    (a, b) =>
      a.start.toMillis() -
      b.start.toMillis()
  );

  return filtered;
}

// --------------------------------------------------
// COUNTDOWN
// --------------------------------------------------

function formatCountdown(start) {
  const now = DateTime.now().setZone(
    "Africa/Nairobi"
  );

  const diffMs =
    start.toMillis() -
    now.toMillis();

  // Event has started.
  if (diffMs <= 0) {
    return "LIVE";
  }

  // Always round UP.
  //
  // 40 seconds  -> 1 minute
  // 40 minutes  -> 40 minutes
  // 59 minutes  -> 59 minutes
  const totalMinutes = Math.ceil(
    diffMs / (60 * 1000)
  );

  const totalHours = Math.floor(
    totalMinutes / 60
  );

  // ----------------------------------------------
  // 24 HOURS OR MORE
  // ----------------------------------------------

  if (totalHours >= 24) {
    const days = Math.ceil(
      totalHours / 24
    );

    return `in ${days} ${
      days === 1
        ? "day"
        : "days"
    }`;
  }

  // ----------------------------------------------
  // 1 HOUR OR MORE
  // ----------------------------------------------

  if (totalHours >= 1) {
    return `in ${totalHours} ${
      totalHours === 1
        ? "hour"
        : "hours"
    }`;
  }

  // ----------------------------------------------
  // UNDER 1 HOUR
  // ----------------------------------------------

  return `in ${totalMinutes} ${
    totalMinutes === 1
      ? "minute"
      : "minutes"
  }`;
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

// --------------------------------------------------
// BUILD SCHEDULE LINES
// --------------------------------------------------

function buildScheduleLines(events) {
  const lines = [];

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━"
  );

  lines.push(
    "        **FUTBOL-X**"
  );

  lines.push(
    "     **LIVE & UPCOMING**"
  );

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━"
  );

  lines.push("");

  const grouped = {};

  for (const event of events) {
    if (event.isLive) {
      continue;
    }

    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }

    grouped[event.category].push(
      event
    );
  }

  let categoryCount = 0;

  for (const category of CATEGORIES) {
    const categoryEvents =
      grouped[category];

    if (
      !categoryEvents ||
      categoryEvents.length === 0
    ) {
      continue;
    }

    // Separator between categories.
    if (categoryCount > 0) {
      lines.push("");
    }

    lines.push(
      `${categoryEmoji(category)} **${category.toUpperCase()}**`
    );

    for (
      const event of categoryEvents
    ) {
      const time =
        event.start.toFormat(
          "h:mm a"
        );

      const countdown =
        formatCountdown(
          event.start
        );

      lines.push(
        `• **${event.name}** — ${time} (${countdown})`
      );
    }

    categoryCount++;
  }

  if (categoryCount === 0) {
    lines.push(
      "*No upcoming events.*"
    );
  }

  return lines;
}

// --------------------------------------------------
// SPLIT SCHEDULE INTO DISCORD-SAFE MESSAGES
// --------------------------------------------------

function splitScheduleMessages(events) {
  const lines =
    buildScheduleLines(events);

  const chunks = [];

  let current = "";

  for (const line of lines) {
    const addition =
      current.length > 0
        ? `\n${line}`
        : line;

    // If adding this line would exceed
    // our safe limit, start a new message.
    if (
      current.length +
        addition.length >
      MAX_MESSAGE_LENGTH
    ) {
      if (current.length > 0) {
        chunks.push(
          current.trim()
        );
      }

      current = line;
    } else {
      current += addition;
    }
  }

  if (current.length > 0) {
    chunks.push(
      current.trim()
    );
  }

  return chunks;
}

// --------------------------------------------------
// BUILD LIVE MESSAGE
// --------------------------------------------------

function buildLiveMessage(liveEvents) {
  let message = "";

  message += "🔴 **LIVE NOW**\n\n";

  for (const event of liveEvents) {
    const emoji =
      categoryEmoji(
        event.category
      );

    message +=
      `${emoji} **${event.name}**\n`;

    message +=
      "🔴 LIVE\n\n";
  }

  message +=
    "━━━━━━━━━━━━━━━━━━━━\n\n";

  message +=
    "🔗 **Events Links Here;**\n";

  message +=
    `${EVENTS_LINK}\n\n`;

  message +=
    "📝 **Event Request Here;**\n";

  message +=
    REQUEST_LINK;

  return message.trim();
}

// --------------------------------------------------
// SMALL UPDATE MESSAGE
// --------------------------------------------------

function buildUpdateMessage(
  newEvents = []
) {
  if (newEvents.length === 1) {
    return (
      `🔔 **Schedule updated**\n` +
      `New event added: **${newEvents[0].name}**`
    );
  }

  if (newEvents.length > 1) {
    return (
      `🔔 **Schedule updated**\n` +
      `${newEvents.length} new events added.`
    );
  }

  return "🔔 **Schedule updated**";
}

// --------------------------------------------------
// FIND ALL SCHEDULE MESSAGES
// --------------------------------------------------

async function findScheduleMessages(
  channel
) {
  const messages =
    await channel.messages.fetch({
      limit: 100
    });

  return messages
    .filter(
      message =>
        message.author.id ===
          client.user.id &&
        message.content.includes(
          "FUTBOL-X"
        ) &&
        message.content.includes(
          "LIVE & UPCOMING"
        )
    )
    .sort(
      (a, b) =>
        a.createdTimestamp -
        b.createdTimestamp
    );
}

// --------------------------------------------------
// FIND ACTIVITY MESSAGE
// --------------------------------------------------

async function findActivityMessage(
  channel
) {
  const messages =
    await channel.messages.fetch({
      limit: 100
    });

  return messages.find(
    message =>
      message.author.id ===
        client.user.id &&
      (
        message.content.includes(
          "🔴 **LIVE NOW**"
        ) ||
        message.content.includes(
          "🔔 **Schedule updated**"
        )
      )
  );
}

// --------------------------------------------------
// DELETE EXTRA SCHEDULE MESSAGES
// --------------------------------------------------

async function deleteExtraScheduleMessages(
  messages,
  keepCount
) {
  if (
    messages.length <= keepCount
  ) {
    return;
  }

  for (
    let i = keepCount;
    i < messages.length;
    i++
  ) {
    try {
      await messages[i].delete();
    } catch {}
  }
}

// --------------------------------------------------
// GET / CREATE SCHEDULE MESSAGES
// --------------------------------------------------

async function getScheduleMessages(
  channel,
  requiredCount
) {
  // ----------------------------------------------
  // Try cached messages first.
  // ----------------------------------------------

  const validCached = [];

  for (
    const message of scheduleMessages
  ) {
    try {
      await message.fetch();

      validCached.push(
        message
      );
    } catch {}
  }

  scheduleMessages =
    validCached;

  // ----------------------------------------------
  // Find existing messages after restart.
  // ----------------------------------------------

  if (
    scheduleMessages.length === 0
  ) {
    scheduleMessages =
      await findScheduleMessages(
        channel
      );
  }

  // ----------------------------------------------
  // Create missing schedule messages.
  // ----------------------------------------------

  while (
    scheduleMessages.length <
    requiredCount
  ) {
    const newMessage =
      await channel.send(
        "Loading Futbol-X schedule..."
      );

    scheduleMessages.push(
      newMessage
    );
  }

  return scheduleMessages;
}

// --------------------------------------------------
// UPDATE ALL SCHEDULE MESSAGES
// --------------------------------------------------

async function updateScheduleMessages(
  channel,
  events
) {
  const chunks =
    splitScheduleMessages(
      events
    );

  const messages =
    await getScheduleMessages(
      channel,
      chunks.length
    );

  // Edit every required message.
  for (
    let i = 0;
    i < chunks.length;
    i++
  ) {
    try {
      await messages[i].edit(
        chunks[i]
      );
    } catch (error) {
      console.error(
        `Failed to edit schedule message ${i + 1}:`,
        error.message
      );
    }
  }

  // Remove old schedule messages
  // if the schedule became shorter.
  await deleteExtraScheduleMessages(
    messages,
    chunks.length
  );

  scheduleMessages =
    messages.slice(
      0,
      chunks.length
    );

  console.log(
    `Schedule split into ${chunks.length} message(s)`
  );
}

// --------------------------------------------------
// DELETE ACTIVITY MESSAGE
// --------------------------------------------------

async function deleteActivityMessage(
  channel
) {
  if (activityMessage) {
    try {
      await activityMessage.delete();
    } catch {}

    activityMessage = null;
  }

  // Also clean up an activity message
  // left behind before a restart.
  const existing =
    await findActivityMessage(
      channel
    );

  if (existing) {
    try {
      await existing.delete();
    } catch {}
  }
}

// --------------------------------------------------
// SEND LIVE MESSAGE
// --------------------------------------------------

async function sendLiveMessage(
  channel,
  liveEvents
) {
  // Delete old LIVE/UPDATE message.
  await deleteActivityMessage(
    channel
  );

  // Nothing live.
  if (
    liveEvents.length === 0
  ) {
    console.log(
      "No live events - LIVE message removed."
    );

    return;
  }

  activityMessage =
    await channel.send(
      buildLiveMessage(
        liveEvents
      )
    );

  console.log(
    `LIVE message sent: ${liveEvents.length} live event(s)`
  );
}

// --------------------------------------------------
// SEND UPDATE NOTIFICATION
// --------------------------------------------------

async function sendUpdateNotification(
  channel,
  newEvents
) {
  await deleteActivityMessage(
    channel
  );

  activityMessage =
    await channel.send(
      buildUpdateMessage(
        newEvents
      )
    );

  console.log(
    `Update notification sent: ${newEvents.length} new event(s)`
  );
}

// --------------------------------------------------
// DETECT CHANGES
// --------------------------------------------------

function detectChanges(
  currentEvents
) {
  // First API check.
  if (
    previousEvents === null
  ) {
    return {
      newEvents: [],
      newlyLive: [],
      endedLive: []
    };
  }

  const previousMap =
    new Map(
      previousEvents.map(
        event => [
          eventKey(event),
          event
        ]
      )
    );

  const currentMap =
    new Map(
      currentEvents.map(
        event => [
          eventKey(event),
          event
        ]
      )
    );

  const newEvents = [];
  const newlyLive = [];
  const endedLive = [];

  // ----------------------------------------------
  // NEW EVENTS
  // ----------------------------------------------

  for (
    const event of currentEvents
  ) {
    const key =
      eventKey(event);

    if (
      !previousMap.has(key)
    ) {
      newEvents.push(event);
    }
  }

  // ----------------------------------------------
  // JUST WENT LIVE
  // ----------------------------------------------

  for (
    const event of currentEvents
  ) {
    const key =
      eventKey(event);

    const previous =
      previousMap.get(key);

    if (
      event.isLive &&
      previous &&
      !previous.isLive
    ) {
      newlyLive.push(event);
    }
  }

  // ----------------------------------------------
  // LIVE EVENTS THAT ENDED
  // ----------------------------------------------

  for (
    const previous of previousEvents
  ) {
    const key =
      eventKey(previous);

    const current =
      currentMap.get(key);

    if (
      previous.isLive &&
      !current
    ) {
      endedLive.push(
        previous
      );
    }
  }

  return {
    newEvents,
    newlyLive,
    endedLive
  };
}

// --------------------------------------------------
// MAIN UPDATE
// --------------------------------------------------

async function updateSchedule() {
  try {
    const channel =
      await client.channels.fetch(
        CHANNEL_ID
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      console.error(
        "Configured channel is not a text channel."
      );

      return;
    }

    // ----------------------------------------------
    // FETCH API
    // ----------------------------------------------

    const allEvents =
      await fetchAllEvents();

    const events =
      processEvents(
        allEvents
      );

    const liveEvents =
      events.filter(
        event => event.isLive
      );

    // ----------------------------------------------
    // DETECT CHANGES
    // ----------------------------------------------

    const {
      newEvents,
      newlyLive,
      endedLive
    } = detectChanges(
      events
    );

    // ----------------------------------------------
    // UPDATE MAIN SCHEDULE
    // ----------------------------------------------

    await updateScheduleMessages(
      channel,
      events
    );

    // ----------------------------------------------
    // EVENT JUST WENT LIVE
    // ----------------------------------------------

    if (
      newlyLive.length > 0
    ) {
      await sendLiveMessage(
        channel,
        liveEvents
      );
    }

    // ----------------------------------------------
    // EVENT JUST ENDED
    // ----------------------------------------------

    else if (
      endedLive.length > 0
    ) {
      // Rebuild immediately.
      //
      // Remaining live events stay.
      // Finished events disappear.
      // If none remain, LIVE NOW is deleted.
      await sendLiveMessage(
        channel,
        liveEvents
      );

      console.log(
        `Live event(s) ended: ${endedLive.length}`
      );
    }

    // ----------------------------------------------
    // NEW UPCOMING EVENTS
    // ----------------------------------------------

    else if (
      newEvents.length > 0
    ) {
      // If something is live,
      // LIVE NOW must remain newest.
      if (
        liveEvents.length > 0
      ) {
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
    }

    // ----------------------------------------------
    // NOTHING IMPORTANT CHANGED
    // ----------------------------------------------

    else {
      if (
        liveEvents.length > 0
      ) {
        // Make sure LIVE NOW exists.
        const existing =
          await findActivityMessage(
            channel
          );

        if (!existing) {
          activityMessage =
            await channel.send(
              buildLiveMessage(
                liveEvents
              )
            );
        } else {
          activityMessage =
            existing;
        }

      } else {
        // Nothing is live.
        //
        // Remove any stale activity message.
        const existing =
          await findActivityMessage(
            channel
          );

        if (existing) {
          try {
            await existing.delete();
          } catch {}

          activityMessage =
            null;
        }
      }
    }

    // ----------------------------------------------
    // SAVE STATE
    // ----------------------------------------------

    previousEvents =
      events;

    console.log(
      `Schedule checked: ${events.length} events | ` +
      `Live: ${liveEvents.length} | ` +
      `New: ${newEvents.length} | ` +
      `Newly live: ${newlyLive.length} | ` +
      `Ended live: ${endedLive.length}`
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
