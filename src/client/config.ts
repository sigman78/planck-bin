import userConfig from '../../planck.config';
import { AppConfig } from './app-controller';

const defaults: AppConfig = {
  appName: 'Planck Bin',
  enableTwitter: true,
  scrollToTopOnSave: true,
  lineNumbers: true,
  highlightCurrentLine: true,
};

export const config: AppConfig = {
  ...defaults,
  ...userConfig,
};

export default config;
