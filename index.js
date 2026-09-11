const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000;
const EVENT_WINDOW = 48 * 60 * 60 * 1000;

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

let scheduleMessage = null;
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
      if (!Array.isArray(group.streams)) continue;

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
    const start = parseEAT(event.starts_at);
    const end = parseEAT(event.ends_at);

    if (!start.isValid || !end.isValid) {
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

  // Event has started
  if (diffMs <= 0) {
    return "LIVE";
  }

  // Round UP so an event 40 seconds away
  // still shows 1 minute instead of 0 minutes.
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
// BUILD MAIN SCHEDULE
// --------------------------------------------------

function buildScheduleMessage(events) {
  let message = "";

  message += "━━━━━━━━━━━━━━━━━━━━\n";
  message += "        **FUTBOL-X**\n";
  message += "     **LIVE & UPCOMING**\n";
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

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
    const categoryEvents =
      grouped[category];

    if (
      !categoryEvents ||
      categoryEvents.length === 0
    ) {
      continue;
    }

    // Small separator between categories
    if (categoryCount > 0) {
      message += "\n";
    }

    message +=
      `${categoryEmoji(category)} **${category.toUpperCase()}**\n`;

    for (const event of categoryEvents) {
      const time =
        event.start.toFormat("h:mm a");

      const countdown =
        formatCountdown(event.start);

      message +=
        `• **${event.name}** — ${time} (${countdown})\n`;
    }

    categoryCount++;
  }

  if (categoryCount === 0) {
    message += "*No upcoming events.*";
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

    // Use the event's actual category
    // instead of always using football.
    const emoji =
      categoryEmoji(event.category);

    message +=
      `${emoji} **${event.name}**\n`;

    message +=
      "🔴 LIVE\n\n";
  }

  message +=
    "━━━━━━━━━━━━━━━━━━━━\n\n";

  message +=
    `🔗 **Events Links Here;**\n`;

  message +=
    `${EVENTS_LINK}\n\n`;

  message +=
    `📝 **Event Request Here;**\n`;

  message +=
    `${REQUEST_LINK}`;

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
// FIND MAIN SCHEDULE MESSAGE
// --------------------------------------------------

async function findScheduleMessage(
  channel
) {
  const messages =
    await channel.messages.fetch({
      limit: 50
    });

  return messages.find(
    message =>
      message.author.id ===
        client.user.id &&
      message.content.includes(
        "FUTBOL-X"
      ) &&
      message.content.includes(
        "LIVE & UPCOMING"
      )
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
      limit: 50
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
// GET MAIN SCHEDULE
// --------------------------------------------------

async function getScheduleMessage(
  channel
) {
  if (scheduleMessage) {
    try {
      await scheduleMessage.fetch();

      return scheduleMessage;

    } catch {
      scheduleMessage = null;
    }
  }

  const existing =
    await findScheduleMessage(
      channel
    );

  if (existing) {
    scheduleMessage =
      existing;

    return existing;
  }

  scheduleMessage =
    await channel.send(
      "Loading Futbol-X schedule..."
    );

  return scheduleMessage;
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

  // Also clean up one that may exist
  // from before a restart.
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
  // Remove the old activity message.
  await deleteActivityMessage(
    channel
  );

  // If nothing is live, leave
  // no LIVE NOW message.
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
  // Don't spam a notification just
  // because the bot started.
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

  // ------------------------------------------------
  // NEW EVENTS
  // ------------------------------------------------

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

  // ------------------------------------------------
  // JUST WENT LIVE
  // ------------------------------------------------

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

  // ------------------------------------------------
  // LIVE EVENTS THAT ENDED
  // ------------------------------------------------

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
    // EDIT MAIN SCHEDULE
    // ----------------------------------------------

    const content =
      buildScheduleMessage(
        events
      );

    const message =
      await getScheduleMessage(
        channel
      );

    await message.edit(
      content
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
      // Immediately rebuild the LIVE message.
      //
      // If other events are still live,
      // only those remaining events are shown.
      //
      // If nothing remains live,
      // the LIVE message is deleted.
      await sendLiveMessage(
        channel,
        liveEvents
      );

      console.log(
        `Live event(s) ended: ${endedLive.length}`
      );
    }

    // ----------------------------------------------
    // NEW UPCOMING EVENT
    // ----------------------------------------------

    else if (
      newEvents.length > 0
    ) {
      // If something is already live,
      // LIVE NOW remains the newest message.
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

          activityMessage = null;
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
  "ready",
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
