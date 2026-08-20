import { describe, it, expect } from 'vitest';
import { extractVideoId } from './youtube.js';

const ID = 'aqz-KE-bpKQ';

describe('extractVideoId', () => {
  it.each([
    ['watch URL', `https://www.youtube.com/watch?v=${ID}`],
    ['watch URL with time offset', `https://www.youtube.com/watch?v=${ID}&t=16s`],
    ['watch URL inside a playlist', `https://www.youtube.com/watch?v=${ID}&list=PLabc123&index=2`],
    ['short youtu.be link', `https://youtu.be/${ID}`],
    ['short link with time offset', `https://youtu.be/${ID}?t=30`],
    ['embed URL', `https://www.youtube.com/embed/${ID}`],
    ['shorts URL', `https://youtube.com/shorts/${ID}`],
    ['live URL', `https://www.youtube.com/live/${ID}`],
    ['legacy /v/ URL', `https://www.youtube.com/v/${ID}`],
    ['nocookie embed', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['mobile URL', `https://m.youtube.com/watch?v=${ID}`],
    ['protocol-relative host', `youtube.com/watch?v=${ID}`],
    ['bare video id', ID],
    ['surrounding whitespace', `  https://youtu.be/${ID}  `],
  ])('extracts from a %s', (_label, input) => {
    expect(extractVideoId(input)).toBe(ID);
  });

  it.each([
    ['a playlist URL with no video', 'https://www.youtube.com/playlist?list=PLabc123'],
    ['a channel URL', 'https://www.youtube.com/@somechannel'],
    ['a non-YouTube host', 'https://vimeo.com/123456789'],
    ['a lookalike host', 'https://notyoutube.com/watch?v=aqz-KE-bpKQ'],
    ['an id of the wrong length', 'https://www.youtube.com/watch?v=tooshort'],
    ['an empty string', ''],
    ['null', null],
    ['a number', 42],
  ])('returns null for %s', (_label, input) => {
    expect(extractVideoId(input)).toBeNull();
  });
});
