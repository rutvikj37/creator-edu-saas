import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CommunicationsPage, CustomFieldsPage, SignupLoginPage, UserExperiencePage } from './PreferencesPages.jsx';
import { academySettingsApi } from '../../../services/api/academySettings.js';

vi.mock('../../../services/api/academySettings.js', () => ({
  academySettingsApi: { preferences: vi.fn(), savePreferences: vi.fn(), customFields: vi.fn(), createCustomField: vi.fn(), updateCustomField: vi.fn(), deleteCustomField: vi.fn(), reorderCustomFields: vi.fn() },
}));
vi.mock('../../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

const wrap = (el) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/creator/settings/x']}>{el}</MemoryRouter></QueryClientProvider>);
const COMMS = { senderName: '', replyTo: '', purchaseAlertEmails: [], emails: {}, emailTypes: [{ tag: 'enrolled', name: 'Course welcome', description: 'Sent on enrolment' }, { tag: 'purchase-receipt', name: 'Purchase receipt', description: 'After payment' }] };

afterEach(() => vi.clearAllMocks());

it('communications: switch an email off, set the sender name and add a purchase alert address', async () => {
  academySettingsApi.preferences.mockResolvedValue(COMMS);
  academySettingsApi.savePreferences.mockImplementation(async (_s, patch) => ({ ...COMMS, ...patch }));
  wrap(<CommunicationsPage />);
  await userEvent.click(await screen.findByRole('switch', { name: 'Course welcome: on' }));
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('communications', { emails: { enrolled: false } }));
  await userEvent.type(screen.getByLabelText('Sender’s name'), 'Speak Academy');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' }).find((b) => !b.disabled));
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('communications', { senderName: 'Speak Academy' }));
  await userEvent.type(screen.getByLabelText('Notification for every successful purchase'), 'sales@example.test{Enter}');
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('communications', { purchaseAlertEmails: ['sales@example.test'] }));
});

it('user experience and signup & login save each switch', async () => {
  academySettingsApi.preferences.mockImplementation(async (s) => (s === 'experience' ? { requireEmailVerification: false, reviewNotifications: true, cookieBanner: false, defaultForm: 'signup' } : { googleEnabled: true, securePasswordPolicy: false }));
  academySettingsApi.savePreferences.mockImplementation(async (_s, patch) => patch);
  const { unmount } = wrap(<UserExperiencePage />);
  await userEvent.click(await screen.findByRole('switch', { name: 'Show cookie notice' }));
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('experience', { cookieBanner: true }));
  await userEvent.selectOptions(screen.getByLabelText('Default form for logged-out visitors'), 'login');
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('experience', { defaultForm: 'login' }));
  unmount();
  wrap(<SignupLoginPage />);
  await userEvent.click(await screen.findByRole('switch', { name: 'Secure password policy' }));
  await waitFor(() => expect(academySettingsApi.savePreferences).toHaveBeenCalledWith('signup', { securePasswordPolicy: true }));
});

it('custom fields: add a dropdown field and reorder', async () => {
  academySettingsApi.customFields.mockResolvedValue([{ id: 'f1', label: 'City', type: 'TEXT', options: [], required: true, editable: true, showInSignup: true, askBeforeCourse: false, position: 0 }, { id: 'f2', label: 'Batch', type: 'TEXT', options: [], required: false, editable: true, showInSignup: false, askBeforeCourse: true, position: 1 }]);
  academySettingsApi.createCustomField.mockResolvedValue({});
  academySettingsApi.reorderCustomFields.mockResolvedValue([]);
  wrap(<CustomFieldsPage />);
  expect(await screen.findByText('Before first course')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Move Batch up' }));
  await waitFor(() => expect(academySettingsApi.reorderCustomFields).toHaveBeenCalledWith(['f2', 'f1']));
  await userEvent.click(screen.getAllByRole('button', { name: 'Add custom field' })[0]);
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/Field title/), 'Course level');
  await userEvent.selectOptions(within(dialog).getByLabelText('Field type'), 'SELECT');
  await userEvent.type(within(dialog).getByLabelText('Choices'), 'Beginner{Enter}Advanced');
  await userEvent.click(within(dialog).getByLabelText('Mark as required'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(academySettingsApi.createCustomField).toHaveBeenCalledWith({ label: 'Course level', type: 'SELECT', options: ['Beginner', 'Advanced'], required: true, editable: true, showInSignup: true, askBeforeCourse: false }));
});
