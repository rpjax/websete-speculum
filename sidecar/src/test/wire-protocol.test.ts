import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MSG_URL,
    MSG_CONSOLE,
    MSG_EVAL_RESULT,
    MSG_SCREENCAST,
    MSG_STATUS,
    MSG_REDIRECT,
    encodeScreencastFrame,
    encodeUrlUpdate,
    encodeConsoleMessage,
    encodeEvalResult,
    encodeRedirectFrame,
    encodeStatusFrame,
} from '../protocol/wire-protocol';

// Golden layouts mirrored from Speculum.Api.Tests/SidecarWireProtocolTests.cs

test('encodeScreencastFrame matches wire layout', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
    const frame = encodeScreencastFrame(jpeg);

    assert.equal(frame[0], MSG_SCREENCAST);
    assert.deepEqual(frame.subarray(1), jpeg);
});

test('encodeUrlUpdate matches wire layout', () => {
    const frame = encodeUrlUpdate('https://example.com/path');

    assert.equal(frame[0], MSG_URL);
    assert.equal(frame.readUInt32LE(1), 24);
    assert.equal(frame.toString('utf8', 5), 'https://example.com/path');
});

test('encodeConsoleMessage matches wire layout', () => {
    const frame = encodeConsoleMessage(2, 'boom');

    assert.equal(frame[0], MSG_CONSOLE);
    assert.equal(frame[1], 2);
    assert.equal(frame[2], 4);
    assert.equal(frame.toString('utf8', 6), 'boom');
});

test('encodeEvalResult matches wire layout', () => {
    const frame = encodeEvalResult(7, true, '{"ok":true}');

    assert.equal(frame[0], MSG_EVAL_RESULT);
    assert.equal(frame.readUInt32LE(1), 7);
    assert.equal(frame[5], 1);
    assert.match(frame.toString('utf8', 10), /"ok"/);
});

test('encodeRedirectFrame matches url layout', () => {
    const frame = encodeRedirectFrame('https://leave.example/');

    assert.equal(frame[0], MSG_REDIRECT);
    assert.equal(frame.toString('utf8', 5), 'https://leave.example/');
});

test('encodeStatusFrame matches wire layout', () => {
    const json = '{"tabCount":1,"url":"https://a","resizing":false,"width":1,"height":2}';
    const frame = encodeStatusFrame(JSON.parse(json));

    assert.equal(frame[0], MSG_STATUS);
    assert.equal(frame.toString('utf8', 5), json);
});
