import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Providers } from '../app/Providers.jsx';

/** Renders UI inside the real providers and a memory router. */
export function renderWithApp(routes, { initialPath = '/' } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return { router, ...render(<Providers><RouterProvider router={router} /></Providers>) };
}
