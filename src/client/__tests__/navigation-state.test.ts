import { browserAnimatedHistoryStep, isSafari } from '../navigation-state';

const UA = {
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0',
};

function popstate(flag?: boolean): Event {
  const evt = new Event('popstate');
  if (flag !== undefined) Object.defineProperty(evt, 'hasUAVisualTransition', { value: flag });
  return evt;
}

describe('isSafari', () => {
  it('matches Safari on Mac and iOS only', () => {
    expect(isSafari(UA.safariMac)).toBe(true);
    expect(isSafari(UA.safariIos)).toBe(true);
    expect(isSafari(UA.chrome)).toBe(false);
    expect(isSafari(UA.chromeIos)).toBe(false);
    expect(isSafari(UA.edge)).toBe(false);
    expect(isSafari(UA.firefox)).toBe(false);
  });
});

describe('browserAnimatedHistoryStep', () => {
  it('trusts the hasUAVisualTransition flag when the browser reports it', () => {
    expect(browserAnimatedHistoryStep(popstate(true), UA.chrome)).toBe(true);
    expect(browserAnimatedHistoryStep(popstate(false), UA.chrome)).toBe(false);
    expect(browserAnimatedHistoryStep(popstate(false), UA.safariMac)).toBe(false);
  });

  it('assumes a browser animation on Safari without the flag, not elsewhere', () => {
    expect(browserAnimatedHistoryStep(popstate(), UA.safariMac)).toBe(true);
    expect(browserAnimatedHistoryStep(popstate(), UA.safariIos)).toBe(true);
    expect(browserAnimatedHistoryStep(popstate(), UA.firefox)).toBe(false);
  });
});
