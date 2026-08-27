/**
 * Shared test helpers.
 *
 * Google throttles reads of the published Sheet from a browser origin hard —
 * measured at three successes in eight tries, the rest hanging past twelve
 * seconds. Every UI test therefore drives the channel list from a stub, so a
 * failure means the UI broke rather than that a third party rate-limited us.
 * The real Sheet has one dedicated test of its own in data-access.spec.js.
 */

const SHEET_GLOB = '**/docs.google.com/**';

/** Channels that are known to be resolvable in docs/handles.json. */
const FIXTURE_CHANNELS = [
  '@Numberblocks',
  '@SciShowKids',
  '@natgeokids',
  '@BlueyOfficialChannel',
];

const csvFor = (handles) =>
  'YouTube channel\n' + handles.map((h) => `https://www.youtube.com/${h}`).join('\n') + '\n';

/** Serve a fixed channel list in place of the live Sheet. */
async function stubSheet(page, handles = FIXTURE_CHANNELS) {
  return stubSheetCsv(page, csvFor(handles));
}

/** Serve arbitrary CSV in place of the live Sheet — settings columns included. */
async function stubSheetCsv(page, csv) {
  await page.route(SHEET_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', body: csv })
  );
}

/** The day boundary the app uses: midnight in Vietnam, whatever the device
 *  clock says. */
function vietnamDayKey(atMs = Date.now()) {
  const vn = new Date(atMs + 7 * 60 * 60 * 1000);
  return `${vn.getUTCFullYear()}-${vn.getUTCMonth() + 1}-${vn.getUTCDate()}`;
}

/** Start the app with today's budget already spent. */
async function seedOutOfTime(page) {
  await page.addInitScript(
    ([key, value]) => {
      try { window.localStorage.setItem(key, value); } catch (e) {}
    },
    ['mintkids.quota', JSON.stringify({ day: vietnamDayKey(), usedMs: 24 * 3600 * 1000 })]
  );
}

module.exports = {
  SHEET_GLOB,
  FIXTURE_CHANNELS,
  csvFor,
  stubSheet,
  stubSheetCsv,
  vietnamDayKey,
  seedOutOfTime,
};
