import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Landing from '../Landing';

let mockShowOnLanding = false;

jest.mock('@react-spring/web', () => ({
  easings: {
    easeOutCubic: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  EModelEndpoint: {
    azureOpenAI: 'azureOpenAI',
    openAI: 'openAI',
  },
}));

jest.mock('@librechat/client', () => ({
  BirthdayIcon: () => <span data-testid="birthday-icon" />,
  TooltipAnchor: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SplitText: ({ text }: { text: string }) => <span>{text}</span>,
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: { endpoint: 'openAI', spec: 'silkroad' } }),
  useAgentsMapContext: () => undefined,
  useAssistantsMapContext: () => undefined,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: { interface: { customWelcome: 'What can I take off your plate?' } },
  }),
  useGetEndpointsQuery: () => ({ data: {} }),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { name: 'Amir' } }),
  useGreeting: () => 'Good evening',
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/utils', () => ({
  CONFIG_HTML_MEDIA_ATTR: {},
  CONFIG_HTML_MEDIA_TAGS: [],
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  createConfigHtmlSanitizer: () => (html: string) => html,
  getIconEndpoint: ({ endpoint }: { endpoint: string }) => endpoint,
  getModelSpec: () => ({
    name: 'silkroad',
    label: 'Silkroad',
    description: "Your company's AI.",
    showOnLanding: mockShowOnLanding,
  }),
  getEntity: () => ({ entity: undefined, isAgent: false, isAssistant: false }),
}));

jest.mock('~/components/Endpoints/ConvoIcon', () => () => <span data-testid="convo-icon" />);

describe('Landing custom welcome', () => {
  beforeEach(() => {
    mockShowOnLanding = false;
  });

  it('renders interface.customWelcome for an enforced spec conversation', () => {
    render(<Landing centerFormOnLanding={false} />);
    expect(screen.getByText('What can I take off your plate?')).toBeInTheDocument();
    expect(screen.queryByText('Silkroad')).not.toBeInTheDocument();
  });

  it('shows the spec label instead only when the spec opts into showOnLanding', () => {
    mockShowOnLanding = true;
    render(<Landing centerFormOnLanding={false} />);
    expect(screen.getByText('Silkroad')).toBeInTheDocument();
    expect(screen.queryByText('What can I take off your plate?')).not.toBeInTheDocument();
  });
});
