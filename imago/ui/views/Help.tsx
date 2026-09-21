/**
 * The panel is the only interface (D-024), so what the tool does has to be legible
 * from inside it. A keystroke nobody can discover is not a feature.
 */
export default function Help() {
  return (
    <>
      <h2>what imago does</h2>
      <p className="sub">One tool, three steps. Each one reads the step before it and never writes back.</p>

      <div className="card help">
        <div className="step">
          <b>1 · Record</b>
          <p>
            Imago opens <b>its own Chrome</b> (your own profile stays untouched) and you browse the site
            by hand. Capture is passive: it never navigates, clicks, freezes or interrupts the page. It
            keeps the whole timeline — every navigation, every request, and a serialized snapshot of the
            page each time it stops moving.
          </p>
          <p className="note">
            Pressing <b>Close sandbox</b> ends the browse: the session is written to disk, references the
            page never actually requested are fetched, and the result is checked for completeness.
          </p>
        </div>

        <div className="step">
          <b>2 · Generate</b>
          <p>
            From a closed session, <b>Generate bundle</b> writes a <code>rehost</code> bundle: the site's
            own HTML, CSS, JavaScript and assets, laid out under the site's own paths, so it runs from
            your machine with no backend behind it. The session is never modified — you can generate from
            it as many times as you like.
          </p>
        </div>

        <div className="step">
          <b>3 · Preview</b>
          <p>
            <b>Preview</b> serves one bundle on its own local address so you can open it in a browser.
            Because the bundle has no backend, you choose what happens to its API calls:
          </p>
          <table className="mini">
            <tbody>
              <tr><td><code>off</code></td><td>the calls fail — you see the empty and error states the site shows when its backend is down</td></tr>
              <tr><td><code>fixtures</code></td><td>the recorded responses are replayed. The site looks alive — but a recorded <code>POST</code> always "succeeds" with the same body, so it lies</td></tr>
              <tr><td><code>proxy</code></td><td>the calls go to a backend you point it at — the real front end driving your half-built server</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card help" style={{ marginTop: 18 }}>
        <div className="step">
          <b>Is the bundle complete?</b>
          <p>
            On a session with a bundle, <b>Check bundle</b> loads it in a headless Chrome, records every
            request it makes and compares the render against the reference captured while you were
            browsing. It answers the question mechanically instead of asking you to read a log:
            <b> missing assets</b> means bytes the bundle should hold (record again so the closing sweep
            downloads them), <b>missing fixtures</b> means API calls you never browsed into, and
            <b> blocked</b> is expected while the api mode is <code>off</code>.
          </p>
        </div>
      </div>

      <h2>keyboard</h2>
      <p className="sub">Every one of these also has a button. The keys are a shortcut, never the only way in.</p>
      <div className="card">
        <table className="keys">
          <tbody>
            <tr>
              <td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></td>
              <td>switch between Record, Sessions, Previews and Help</td>
              <td className="muted">same as clicking the sidebar</td>
            </tr>
            <tr>
              <td><kbd>m</kbd></td>
              <td>while recording, capture the page as it is right now</td>
              <td className="muted">same as the <b>Mark state</b> button</td>
            </tr>
            <tr>
              <td><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd></td>
              <td><b>inside the Chrome window being recorded</b> — capture without coming back here</td>
              <td className="muted">for when your hands are on the site</td>
            </tr>
            <tr>
              <td><kbd>/</kbd></td>
              <td>jump to the session filter</td>
              <td className="muted">same as clicking the filter box</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>marking a state</h2>
      <div className="card">
        <p className="note">
          Imago snapshots the page on its own whenever it settles, and every 20 seconds on a page that
          never settles. <b>Mark state</b> is for the moments those rules miss: a menu you opened, a modal,
          a tab, a hover — anything that exists only while you are holding it. A mark is always captured,
          settled or not.
        </p>
      </div>

      <h2>where the data lives</h2>
      <div className="card">
        <p className="note">
          Everything is under <code>.imago/</code> next to the program: one folder per session, with the
          bundles you generate inside it. Sessions are never modified after they close, and nothing is
          ever deleted unless you delete it — <b>Sessions</b> has the buttons.
        </p>
      </div>
    </>
  )
}
