import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import { authClient } from '../auth/client';

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: '/login' });
  },
  component: AppShell,
});
