const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000;

// Keep looking 48 hours ahead for events,
// but only DISPLAY the closest few per category.
const EVENT_WINDOW = 48 * 60 * 60 * 1000;

// Number of upcoming events shown per category.
// When one starts/leaves, the next one automatically appears.
const MAX_UPCOMING_PER_CATEGORY = 5;

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

const SCHEDULE_MAX_LENGTH = 1900;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let previousEvents = null;

let scheduleMessages = [];
let activityMessage = null;


/* =========================================================
   TIME
========================================================= */

function parseEAT(dateString) {
  return DateTime.fromISO(dateString, {
    zone: "Africa/Nairobi"
  });
}


/* =========================================================
   CATEGORY LOGOS / EMOJIS
========================================================= */

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


/* =========================================================
   FETCH ONE CATEGORY
========================================================= */

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

    if (!data.success || !Array.isArray(data.streams)) {
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


/* =========================================================
   FETCH EVERYTHING
========================================================= */

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category =>
      fetchCategory(category)
    )
  );

  return results.flat();
}


/* =========================================================
   EVENT KEY
========================================================= */

function eventKey(event) {
  return [
    event.category,
    event.name,
    event.starts_at,
    event.ends_at
  ].join("|");
}


/* =========================================================
   PROCESS EVENTS
========================================================= */

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


/* =========================================================
   ROLLING UPCOMING EVENTS
========================================================= */

function getUpcomingEvents(events) {
  const grouped = {};

  for (const event of events) {
    if (event.isLive) {
      continue;
    }

    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }

    grouped[event.category].push(event);
  }

  const result = [];

  for (const category of CATEGORIES) {
    if (!grouped[category]) {
      continue;
    }

    // Already sorted by start time.
    // Only keep the nearest 5.
    const nearest = grouped[category].slice(
      0,
      MAX_UPCOMING_PER_CATEGORY
    );

    result.push(...nearest);
  }

  return result;
}


/* =========================================================
   COUNTDOWN
========================================================= */

function formatCountdown(start) {
  const now = DateTime.now().setZone(
    "Africa/Nairobi"
  );

  const diffMs =
    start.toMillis() -
    now.toMillis();

  if (diffMs <= 0) {
    return "LIVE";
  }

  const totalMinutes = Math.floor(
    diffMs / (60 * 1000)
  );

  // Prevent "in 0 minutes"
  const minutesSafe = Math.max(
    1,
    totalMinutes
  );

  // 24 hours or more
  if (minutesSafe >= 24 * 60) {
    const days = Math.ceil(
      minutesSafe / (24 * 60)
    );

    return `in ${days} ${
      days === 1 ? "day" : "days"
    }`;
  }

  // 1 hour or more
  const hours = Math.floor(
    minutesSafe / 60
  );

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


/* =========================================================
   SCHEDULE LINES
========================================================= */

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

  const grouped = {};

  for (const event of events) {
    if (event.isLive) {
      continue;
    }

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

    if (categoryCount > 0) {
      lines.push("");
    }

    lines.push(
      `${categoryEmoji(category)} **${category.toUpperCase()}**`
    );

    for (const event of categoryEvents) {
      const time =
        event.start.toFormat("h:mm a");

      const countdown =
        formatCountdown(event.start);

      lines.push(
        `• **${event.name}** — ${time} (${countdown})`
      );
    }

    categoryCount++;
  }

  if (categoryCount === 0) {
    lines.push("");
    lines.push(
      "*No upcoming events.*"
    );
  }

  return lines;
}


/* =========================================================
   SPLIT SCHEDULE INTO SAFE DISCORD MESSAGES
========================================================= */

function buildScheduleMessages(events) {
  const lines =
    buildScheduleLines(events);

  const chunks = [];

  let current = "";
  let chunkNumber = 0;

  const continuationHeader =
    "**FUTBOL-X • SCHEDULE CONTINUED**";

  for (const line of lines) {
    const prefix =
      chunkNumber === 0
        ? ""
        : continuationHeader + "\n";

    const candidate =
      current.length > 0
        ? `${current}\n${line}`
        : `${prefix}${line}`;

    if (
      candidate.length <=
      SCHEDULE_MAX_LENGTH
    ) {
      current = candidate;
      continue;
    }

    // Save current chunk
    if (current.length > 0) {
      chunks.push(current.trim());
      chunkNumber++;
    }

    const newPrefix =
      chunkNumber === 0
        ? ""
        : continuationHeader + "\n";

    const singleLine =
      `${newPrefix}${line}`;

    // Extremely long event name protection
    if (
      singleLine.length >
      SCHEDULE_MAX_LENGTH
    ) {
      let remaining = singleLine;

      while (
        remaining.length >
        SCHEDULE_MAX_LENGTH
      ) {
        chunks.push(
          remaining.slice(
            0,
            SCHEDULE_MAX_LENGTH
          )
        );

        remaining =
          remaining.slice(
            SCHEDULE_MAX_LENGTH
          );

        chunkNumber++;
      }

      current = remaining;
    } else {
      current = singleLine;
    }
  }

  if (current.length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}


/* =========================================================
   SCHEDULE MESSAGE DETECTION
========================================================= */

function isScheduleMessage(message) {
  if (
    !message ||
    message.author.id !== client.user.id
  ) {
    return false;
  }

  return (
    message.content.includes(
      "LIVE & UPCOMING"
    ) ||
    message.content.includes(
      "FUTBOL-X • SCHEDULE CONTINUED"
    )
  );
}


async function findScheduleMessages(channel) {
  const fetched =
    await channel.messages.fetch({
      limit: 100
    });

  // IMPORTANT:
  // Discord returns a Collection.
  // Convert it to an actual array.
  const messages =
    Array.from(fetched.values());

  return messages
    .filter(isScheduleMessage)
    .sort(
      (a, b) =>
        a.createdTimestamp -
        b.createdTimestamp
    );
}


/* =========================================================
   UPDATE ALL SCHEDULE MESSAGES
========================================================= */

async function updateScheduleMessages(
  channel,
  contents
) {
  let existing =
    await findScheduleMessages(channel);

  let createdNewMessage = false;

  /*
   * EDIT EXISTING MESSAGES
   */

  const commonCount = Math.min(
    existing.length,
    contents.length
  );

  for (
    let i = 0;
    i < commonCount;
    i++
  ) {
    try {
      await existing[i].edit(
        contents[i]
      );
    } catch (error) {
      console.error(
        `Failed to edit schedule message ${
          i + 1
        }:`,
        error.message
      );
    }
  }


  /*
   * CREATE MISSING MESSAGES
   */

  if (
    contents.length >
    existing.length
  ) {
    for (
      let i = existing.length;
      i < contents.length;
      i++
    ) {
      try {
        const newMessage =
          await channel.send(
            contents[i]
          );

        existing.push(
          newMessage
        );

        createdNewMessage = true;

      } catch (error) {
        console.error(
          `Failed to create schedule message ${
            i + 1
          }:`,
          error.message
        );
      }
    }
  }


  /*
   * DELETE EXTRA OLD MESSAGES
   */

  if (
    existing.length >
    contents.length
  ) {
    for (
      let i = contents.length;
      i < existing.length;
      i++
    ) {
      try {
        await existing[i].delete();
      } catch (error) {
        console.error(
          "Failed to delete old schedule message:",
          error.message
        );
      }
    }

    existing =
      existing.slice(
        0,
        contents.length
      );
  }


  scheduleMessages = existing;

  return createdNewMessage;
}


/* =========================================================
   ACTIVITY MESSAGE DETECTION
========================================================= */

function isActivityMessage(message) {
  if (
    !message ||
    message.author.id !== client.user.id
  ) {
    return false;
  }

  return (
    message.content.includes(
      "🔴 **LIVE NOW**"
    ) ||
    message.content.includes(
      "🔔 **Schedule updated**"
    )
  );
}


async function findActivityMessages(channel) {
  const fetched =
    await channel.messages.fetch({
      limit: 100
    });

  const messages =
    Array.from(fetched.values());

  return messages
    .filter(isActivityMessage)
    .sort(
      (a, b) =>
        b.createdTimestamp -
        a.createdTimestamp
    );
}


/* =========================================================
   DELETE ACTIVITY MESSAGES
========================================================= */

async function deleteActivityMessage(
  channel
) {
  const messages =
    await findActivityMessages(channel);

  for (const message of messages) {
    try {
      await message.delete();
    } catch {}
  }

  activityMessage = null;
}


/* =========================================================
   LIVE MESSAGE
========================================================= */

function buildLiveMessage(
  liveEvents
) {
  let message =
    "🔴 **LIVE NOW**\n\n";

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
    `🔗 **Events Links Here;**\n`;

  message +=
    `${EVENTS_LINK}\n\n`;

  message +=
    `📝 **Event Request Here;**\n`;

  message +=
    `${REQUEST_LINK}`;

  return message.trim();
}


/* =========================================================
   SEND LIVE MESSAGE
========================================================= */

async function sendLiveMessage(
  channel,
  liveEvents
) {
  await deleteActivityMessage(
    channel
  );

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


/* =========================================================
   UPDATE NOTIFICATION
========================================================= */

function buildUpdateMessage(
  newEvents = []
) {
  if (
    newEvents.length === 1
  ) {
    return (
      `🔔 **Schedule updated**\n` +
      `New event added: **${newEvents[0].name}**`
    );
  }

  if (
    newEvents.length > 1
  ) {
    return (
      `🔔 **Schedule updated**\n` +
      `${newEvents.length} new events added.`
    );
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


/* =========================================================
   CHANGE DETECTION
========================================================= */

function detectChanges(
  currentEvents
) {
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


  /*
   * NEW EVENTS
   */

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


  /*
   * NEWLY LIVE
   */

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


  /*
   * EVENTS THAT STOPPED BEING LIVE
   *
   * Handles both:
   * 1. Event disappeared completely
   * 2. Event still exists but isLive became false
   */

  for (
    const previous of previousEvents
  ) {
    if (!previous.isLive) {
      continue;
    }

    const key =
      eventKey(previous);

    const current =
      currentMap.get(key);

    if (
      !current ||
      !current.isLive
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


/* =========================================================
   KEEP LIVE MESSAGE NEWEST
========================================================= */

async function ensureLiveMessage(
  channel,
  liveEvents,
  forceNew = false
) {
  const activities =
    await findActivityMessages(
      channel
    );

  const liveMessage =
    activities.find(
      message =>
        message.content.includes(
          "🔴 **LIVE NOW**"
        )
    );

  /*
   * If we specifically need a fresh message,
   * delete the old one and send a new one.
   */

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

  /*
   * Delete duplicate/old activity messages.
   */

  for (
    const message of activities
  ) {
    if (
      message.id ===
      liveMessage.id
    ) {
      continue;
    }

    try {
      await message.delete();
    } catch {}
  }

  activityMessage =
    liveMessage;
}


/* =========================================================
   MAIN UPDATE
========================================================= */

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


    /*
     * FETCH
     */

    const allEvents =
      await fetchAllEvents();


    /*
     * PROCESS
     */

    const events =
      processEvents(
        allEvents
      );


    /*
     * LIVE EVENTS
     */

    const liveEvents =
      events.filter(
        event => event.isLive
      );


    /*
     * ONLY SHOW THE CLOSEST UPCOMING
     */

    const upcomingEvents =
      getUpcomingEvents(
        events
      );


    /*
     * DETECT CHANGES
     */

    const {
      newEvents,
      newlyLive,
      endedLive
    } =
      detectChanges(
        events
      );


    /*
     * BUILD ROLLING SCHEDULE
     */

    const scheduleContents =
      buildScheduleMessages(
        upcomingEvents
      );


    /*
     * UPDATE SCHEDULE
     */

    const createdScheduleMessage =
      await updateScheduleMessages(
        channel,
        scheduleContents
      );


    /*
     * ACTIVITY LOGIC
     */

    if (
      newlyLive.length > 0
    ) {
      /*
       * New live event:
       * ALWAYS create a fresh LIVE message.
       */

      await sendLiveMessage(
        channel,
        liveEvents
      );

    } else if (
      endedLive.length > 0
    ) {
      /*
       * Something ended.
       *
       * If another event is live,
       * rebuild LIVE NOW.
       *
       * If nothing is live,
       * remove LIVE NOW immediately.
       */

      await sendLiveMessage(
        channel,
        liveEvents
      );

      console.log(
        `Live event(s) ended: ${endedLive.length}`
      );

    } else if (
      newEvents.length > 0
    ) {
      if (
        liveEvents.length > 0
      ) {
        /*
         * New event appeared while
         * something else is live.
         */

        await sendLiveMessage(
          channel,
          liveEvents
        );

      } else {
        /*
         * New upcoming event,
         * no live events.
         */

        await sendUpdateNotification(
          channel,
          newEvents
        );
      }

    } else {
      /*
       * Nothing fundamentally changed.
       */

      if (
        liveEvents.length > 0
      ) {
        /*
         * If new schedule chunks were created,
         * LIVE NOW must become newest again.
         */

        await ensureLiveMessage(
          channel,
          liveEvents,
          createdScheduleMessage
        );

      } else {
        /*
         * Nothing live.
         * Remove any stale activity message.
         */

        await deleteActivityMessage(
          channel
        );
      }
    }


    /*
     * SAVE CURRENT STATE
     */

    previousEvents =
      events;


    /*
     * LOG
     */

    console.log(
      `Schedule checked: ` +
      `${events.length} tracked | ` +
      `${upcomingEvents.length} displayed upcoming | ` +
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


/* =========================================================
   BOT READY
========================================================= */

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


/* =========================================================
   ENV CHECK
========================================================= */

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


/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
