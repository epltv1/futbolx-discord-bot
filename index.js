const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000;
const EVENT_WINDOW = 48 * 60 * 60 * 1000;

// Stay below Discord's 2000-character limit.
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
  "https://futbol-x.xyz/api";

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
   CATEGORY EMOJIS
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
    const response = await fetch(`${API_BASE}/${category}.json`);

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
   FETCH ALL CATEGORIES
========================================================= */

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category => fetchCategory(category))
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
  const now = DateTime.now().setZone("Africa/Nairobi");

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


/* =========================================================
   UPCOMING EVENTS
========================================================= */

function getUpcomingEvents(events) {
  return events
    .filter(event => !event.isLive)
    .sort(
      (a, b) =>
        a.start.toMillis() -
        b.start.toMillis()
    );
}


/* =========================================================
   COUNTDOWN
========================================================= */

function formatCountdown(start) {
  const now = DateTime.now().setZone("Africa/Nairobi");

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

  // 24 hours or more
  if (minutesSafe >= 24 * 60) {
    const days =
      Math.ceil(
        minutesSafe / (24 * 60)
      );

    return `in ${days} ${
      days === 1 ? "day" : "days"
    }`;
  }

  // 1 hour or more
  const hours =
    Math.floor(
      minutesSafe / 60
    );

  if (hours >= 1) {
    return `in ${hours} ${
      hours === 1 ? "hour" : "hours"
    }`;
  }

  // Less than 1 hour
  return `in ${minutesSafe} ${
    minutesSafe === 1
      ? "minute"
      : "minutes"
  }`;
}


/* =========================================================
   BUILD SCHEDULE LINES
========================================================= */

function buildScheduleLines(events) {
  const lines = [];

  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("        **FUTBOL-X**");
  lines.push("     **LIVE & UPCOMING**");
  lines.push("━━━━━━━━━━━━━━━━━━━━");

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

      // IMPORTANT:
      // The complete fixture is ONE line.
      // It will never be intentionally split.
      lines.push(
        `• **${event.name}** — ${time} (${countdown})`
      );
    }

    categoryCount++;
  }

  if (categoryCount === 0) {
    lines.push("");
    lines.push("*No upcoming events.*");
  }

  return lines;
}


/* =========================================================
   BUILD MULTIPLE SCHEDULE MESSAGES
   =========================================================

   IMPORTANT:

   Each line is indivisible.

   Example:

   • **Manchester City vs Manchester United** — 8:00 PM (in 2 hours)

   If that entire line doesn't fit in the current
   Discord message, the ENTIRE line moves to the
   next message.

   It will NOT become:

   Message 1:
   • Manchester City vs

   Message 2:
   Manchester United
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

    // The complete line fits.
    if (
      candidate.length <=
      SCHEDULE_MAX_LENGTH
    ) {
      current = candidate;
      continue;
    }

    // Current message is full enough.
    if (current.length > 0) {
      chunks.push(
        current.trim()
      );

      chunkNumber++;
    }

    const newPrefix =
      chunkNumber === 0
        ? ""
        : continuationHeader + "\n";

    const completeLine =
      `${newPrefix}${line}`;

    /*
      A normal fixture should never be anywhere
      close to 1900 characters.

      If a single line somehow exceeds the limit,
      we DO NOT slice it in half because that would
      recreate the exact problem we're preventing.

      Instead, shorten only an absurdly long event
      name while keeping the fixture on ONE line.
    */

    if (
      completeLine.length >
      SCHEDULE_MAX_LENGTH
    ) {
      const availableForLine =
        SCHEDULE_MAX_LENGTH -
        newPrefix.length;

      const suffix =
        "…";

      const shortened =
        line.slice(
          0,
          Math.max(
            1,
            availableForLine -
            suffix.length
          )
        ) + suffix;

      current =
        `${newPrefix}${shortened}`;

      continue;
    }

    // Start the next message with the
    // COMPLETE line.
    current = completeLine;
  }

  if (current.length > 0) {
    chunks.push(
      current.trim()
    );
  }

  return chunks;
}


/* =========================================================
   IDENTIFY SCHEDULE MESSAGES
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


/* =========================================================
   FIND SCHEDULE MESSAGES
========================================================= */

async function findScheduleMessages(channel) {
  const fetched =
    await channel.messages.fetch({
      limit: 100
    });

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
   UPDATE SCHEDULE MESSAGES
========================================================= */

async function updateScheduleMessages(
  channel,
  contents
) {
  let existing =
    await findScheduleMessages(channel);

  let createdNewMessage = false;

  const commonCount =
    Math.min(
      existing.length,
      contents.length
    );

  /*
    Edit existing messages first.
  */

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
        `Failed to edit schedule message ${i + 1}:`,
        error.message
      );
    }
  }

  /*
    Create additional messages
    when the schedule needs more chunks.
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
          `Failed to create schedule message ${i + 1}:`,
          error.message
        );
      }
    }
  }

  /*
    Delete extra old messages
    when the schedule becomes shorter.
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

  scheduleMessages =
    existing;

  return createdNewMessage;
}


/* =========================================================
   ACTIVITY MESSAGES
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


/* =========================================================
   FIND ACTIVITY MESSAGES
========================================================= */

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
   DELETE ACTIVITY MESSAGE
========================================================= */

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
    } catch {}
  }

  activityMessage = null;
}


/* =========================================================
   BUILD LIVE MESSAGE
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
    "🔗 **Events Links Here;**\n";

  message +=
    `${EVENTS_LINK}\n\n`;

  message +=
    "📝 **Event Request Here;**\n";

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
  // Remove previous LIVE/UPDATE activity.
  await deleteActivityMessage(
    channel
  );

  // If nothing is live, stop here.
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


/* =========================================================
   SEND UPDATE NOTIFICATION
========================================================= */

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
   DETECT CHANGES
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
    New events.
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
    Events that changed
    from upcoming -> LIVE.
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
    Events that were LIVE
    but are no longer LIVE.
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
   ENSURE LIVE MESSAGE
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
    New LIVE event or schedule message
    was newly created -> send a fresh
    LIVE message so Discord gives the
    channel a new-message indicator.
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
    Remove stale activity messages.
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
   MAIN SCHEDULE UPDATE
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
      Fetch everything.
    */

    const allEvents =
      await fetchAllEvents();

    /*
      Keep:
      - currently live events
      - upcoming events within 48 hours
    */

    const events =
      processEvents(
        allEvents
      );

    /*
      Separate LIVE and upcoming.
    */

    const liveEvents =
      events.filter(
        event => event.isLive
      );

    const upcomingEvents =
      getUpcomingEvents(
        events
      );

    /*
      Detect changes since last poll.
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
      Build schedule.

      IMPORTANT:
      Every fixture remains a complete
      indivisible line.
    */

    const scheduleContents =
      buildScheduleMessages(
        upcomingEvents
      );

    /*
      Update schedule messages.
    */

    const createdScheduleMessage =
      await updateScheduleMessages(
        channel,
        scheduleContents
      );


    /* =====================================================
       ACTIVITY LOGIC
    ===================================================== */

    /*
      A new event became LIVE.
      Delete old activity and create
      a brand-new LIVE NOW message.
    */

    if (
      newlyLive.length > 0
    ) {
      await sendLiveMessage(
        channel,
        liveEvents
      );
    }

    /*
      A LIVE event ended.

      Immediately rebuild the LIVE message
      so ended events disappear on this poll.
    */

    else if (
      endedLive.length > 0
    ) {
      await sendLiveMessage(
        channel,
        liveEvents
      );

      console.log(
        `Live event(s) ended: ${endedLive.length}`
      );
    }

    /*
      New upcoming event appeared.
    */

    else if (
      newEvents.length > 0
    ) {

      /*
        If something is currently LIVE,
        LIVE NOW must remain the newest
        activity message.
      */

      if (
        liveEvents.length > 0
      ) {
        await sendLiveMessage(
          channel,
          liveEvents
        );
      }

      /*
        No live events -> send schedule
        update notification.
      */

      else {
        await sendUpdateNotification(
          channel,
          newEvents
        );
      }
    }

    /*
      Nothing structurally changed.
    */

    else {

      /*
        If something is live, make sure
        LIVE NOW exists.
      */

      if (
        liveEvents.length > 0
      ) {
        await ensureLiveMessage(
          channel,
          liveEvents,
          createdScheduleMessage
        );
      }

      /*
        Nothing is live -> remove any
        old LIVE/UPDATE message.
      */

      else {
        await deleteActivityMessage(
          channel
        );
      }
    }


    /*
      Save current state for the next
      60-second poll.
    */

    previousEvents =
      events;


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
   ENVIRONMENT CHECKS
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
