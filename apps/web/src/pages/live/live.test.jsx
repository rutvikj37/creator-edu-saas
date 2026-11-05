import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { LiveClassesPage } from '../creator/LiveClassesPage.jsx';
import { StudentLivePage, WebinarPage } from './LivePages.jsx';
import { LiveRoom } from '../../components/live/LiveRoom.jsx';
import { batchesApi, creatorLiveApi, learnLiveApi, webinarApi } from '../../services/api/live.js';
import { academyApi } from '../../services/api/auth.js';

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }) => <div data-testid="lk-room">{children}</div>,
  VideoConference: () => <div>conference</div>,
  RoomAudioRenderer: () => null,
}));
vi.mock('@livekit/components-styles', () => ({}));
vi.mock('../../services/api/live.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    creatorLiveApi: { providers: vi.fn(), classes: vi.fn(), create: vi.fn(), admissions: vi.fn(async () => []) },
    batchesApi: { list: vi.fn(async () => []) },
    learnLiveApi: { upcoming: vi.fn(), recordings: vi.fn(async () => []), join: vi.fn() },
    webinarApi: { get: vi.fn(), register: vi.fn() },
  };
});
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c'.repeat(25), title: 'Python' }] })) } }));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({ name: 'Acme', theme: {} })) }, workspaceApi: { workspace: vi.fn() } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', can: () => true }) }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => null, CourseCard: () => null }));

function wrap(element, path = '/', route = '/') {
  const router = createMemoryRouter([{ path: route, element }, { path: '*', element: <div>elsewhere</div> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

afterEach(() => vi.clearAllMocks());

describe('LiveClassesPage', () => {
  it('offers the meeting-link option when the built-in classroom is not set up and validates the form', async () => {
    creatorLiveApi.providers.mockResolvedValue({ livekit: false, external: true, recording: false });
    creatorLiveApi.classes.mockResolvedValue([]);
    creatorLiveApi.create.mockResolvedValue({ id: 'new1' });
    const router = wrap(<LiveClassesPage />);
    expect(await screen.findByText(/built-in classroom isn't set up/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Built-in classroom/ })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Office hours');
    await userEvent.type(within(dialog).getByLabelText('Meeting link'), 'zoom.us/j/1');
    await userEvent.click(within(dialog).getByLabelText('Repeats weekly'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText(/Paste your Zoom/)).toBeInTheDocument();
    expect(within(dialog).getByText('Pick at least one day')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Meeting link'));
    await userEvent.type(within(dialog).getByLabelText('Meeting link'), 'https://zoom.us/j/123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(creatorLiveApi.create).toHaveBeenCalled());
    expect(creatorLiveApi.create.mock.calls[0][0]).toMatchObject({ title: 'Office hours', provider: 'EXTERNAL', externalUrl: 'https://zoom.us/j/123', audience: 'ALL_STUDENTS', recurrence: { freq: 'WEEKLY', byDay: ['TU'], count: 8 }, waitingRoom: false });
    await waitFor(() => expect(router.state.location.pathname).toBe('/creator/live/new1'));
    expect(batchesApi.list).toHaveBeenCalled();
  });
});

describe('LiveClassesPage with plugNmeet', () => {
  it('defaults to the plugNmeet classroom and sends waiting room / recording', async () => {
    creatorLiveApi.providers.mockResolvedValue({ livekit: false, plugnmeet: true, external: true, recording: true, livekitRecording: false, plugnmeetRecording: true });
    creatorLiveApi.classes.mockResolvedValue([{ id: 'k1', title: 'Algebra live', provider: 'PLUGNMEET', audience: 'ALL_STUDENTS', status: 'ACTIVE' }]);
    creatorLiveApi.create.mockResolvedValue({ id: 'new2' });
    wrap(<LiveClassesPage />);
    expect((await screen.findAllByText('plugNmeet classroom'))[0]).toBeInTheDocument(); // list label
    expect(screen.queryByText(/built-in classroom isn't set up/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /plugNmeet classroom/ })).toBeChecked();
    expect(within(dialog).queryByRole('radio', { name: /Built-in classroom/ })).toBeNull(); // LiveKit not set up: not offered
    expect(within(dialog).queryByLabelText('Meeting link')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Algebra live');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Waiting room/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Record sessions/ }));
    expect(within(dialog).getByText(/added to your video library after the session/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(creatorLiveApi.create).toHaveBeenCalled());
    expect(creatorLiveApi.create.mock.calls[0][0]).toMatchObject({ provider: 'PLUGNMEET', waitingRoom: true, recordSessions: true });
    expect(creatorLiveApi.create.mock.calls[0][0].externalUrl).toBeUndefined();
  });
});

describe('StudentLivePage', () => {
  it('opens the plugNmeet classroom from Join', async () => {
    learnLiveApi.upcoming.mockResolvedValue([{ id: 's1', startsAt: new Date().toISOString(), status: 'LIVE', joinOpensAt: new Date(Date.now() - 60_000).toISOString(), liveClass: { title: 'Algebra live' } }]);
    learnLiveApi.join.mockResolvedValue({ provider: 'PLUGNMEET', joinUrl: 'https://meet.example.test/?access_token=abc', role: 'attendee' });
    const tab = { opener: 'x' };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    wrap(<StudentLivePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://meet.example.test/?access_token=abc', '_blank'));
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it('enables Join only once the session opens', async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    learnLiveApi.upcoming.mockResolvedValue([
      { id: 's1', startsAt: soon, status: 'SCHEDULED', joinOpensAt: new Date(Date.now() - 10 * 60_000).toISOString(), liveClass: { title: 'Python lab' } },
      { id: 's2', startsAt: later, status: 'SCHEDULED', joinOpensAt: later, liveClass: { title: 'Next week' } },
    ]);
    learnLiveApi.join.mockResolvedValue({ provider: 'LIVEKIT', url: 'wss://x', token: 't' });
    const router = wrap(<StudentLivePage />);
    const join = await screen.findByRole('button', { name: 'Join' });
    expect(screen.getByRole('button', { name: /^Opens/ })).toBeDisabled();
    await userEvent.click(join);
    await waitFor(() => expect(router.state.location.pathname).toBe('/learn/live/s1'));
  });
});

describe('WebinarPage', () => {
  it('registers and confirms by email', async () => {
    webinarApi.get.mockResolvedValue({ slug: 'py', title: 'Free Python Masterclass', description: 'Learn fast', durationMinutes: 60, sessions: [{ id: 's1', startsAt: new Date(Date.now() + 86_400_000).toISOString() }], seatsLeft: 99, open: true });
    webinarApi.register.mockResolvedValue({ registered: true, email: 'guest@example.test' });
    wrap(<WebinarPage />, '/webinars/py', '/webinars/:slug');
    expect(await screen.findByText('Free Python Masterclass')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Guest');
    await userEvent.type(screen.getByLabelText('Email'), 'guest@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Register for free' }));
    expect(await screen.findByText(/sent your personal join link to guest@example.test/)).toBeInTheDocument();
    expect(webinarApi.register).toHaveBeenCalledWith('py', { name: 'Guest', email: 'guest@example.test', consent: false });
  });
});

describe('Paid webinars', () => {
  it('public page sells a ticket instead of free registration', async () => {
    academyApi.site.mockResolvedValueOnce({ name: 'Acme', theme: {}, paymentsEnabled: true });
    webinarApi.get.mockResolvedValue({ id: 'w1', slug: 'tax', title: 'Tax Saving Masterclass', description: null, durationMinutes: 60, sessions: [{ id: 's1', startsAt: new Date(Date.now() + 86_400_000).toISOString() }], seatsLeft: 2, open: true, priceAmount: '299', currency: 'INR' });
    const router = wrap(<WebinarPage />, '/webinars/tax', '/webinars/:slug');
    expect(await screen.findByText('₹299.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register for free' })).toBeNull();
    expect(screen.getByText('2 seats left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buy ticket' }));
    expect(router.state.location.pathname).toBe('/checkout/webinar/tax');
  });

  it('creator sets a ticket price on a webinar', async () => {
    creatorLiveApi.providers.mockResolvedValue({ livekit: false, plugnmeet: false, external: true, recording: false });
    creatorLiveApi.classes.mockResolvedValue([]);
    creatorLiveApi.create.mockResolvedValue({ id: 'w2' });
    wrap(<LiveClassesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Webinars' }));
    await userEvent.click(screen.getByRole('button', { name: 'New webinar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Tax Saving Masterclass');
    await userEvent.type(within(dialog).getByLabelText('Meeting link'), 'https://meet.example.test/tax');
    await userEvent.type(within(dialog).getByLabelText('Ticket price'), '299');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(creatorLiveApi.create).toHaveBeenCalled());
    expect(creatorLiveApi.create.mock.calls[0][0]).toMatchObject({ kind: 'WEBINAR', priceAmount: 299 });
  });
});

describe('LiveRoom', () => {
  it('holds waiting participants until admitted', async () => {
    let status = 'WAITING';
    const api = { key: 'k', admission: vi.fn(async () => ({ status })), polls: vi.fn(async () => []), questions: vi.fn(async () => []) };
    wrap(<LiveRoom join={{ url: 'wss://x', token: 't', waiting: true }} title="Class" sessionId="s1" api={api} onLeave={() => {}} />);
    expect(await screen.findByText(/Waiting for the host/)).toBeInTheDocument();
    expect(screen.queryByText('conference')).not.toBeInTheDocument();
    status = 'ADMITTED';
    expect(await screen.findByText('conference', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
