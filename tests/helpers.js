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
  await page.route(SHEET_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(handles) })
  );
}

module.exports = { SHEET_GLOB, FIXTURE_CHANNELS, csvFor, stubSheet };
