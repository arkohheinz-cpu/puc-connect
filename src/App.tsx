import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { Layout } from './components/layout/Layout';
import { getAuthSession, signOut } from './api';
import { Login, Register } from './pages/Auth';
import Attendance from './pages/Attendance';
import Directory from './pages/Directory';
import EditProfile from './pages/EditProfile';
import Home from './pages/Home';
import Join from './pages/Join';
import NotFound from './pages/NotFound';
import Profile from './pages/Profile';
import Resources from './pages/Resources';
import VerifyEmail from './pages/VerifyEmail';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function Router() {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: ({ signal }) => getAuthSession(signal),
    staleTime: 30_000,
  });
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await queryClient.cancelQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      });
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      });
      const session = await getAuthSession();
      queryClient.setQueryData(['auth'], session);
      navigate('/login');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not sign out.');
    },
  });

  return (
    <Layout
      user={auth.data?.user ?? null}
      onLogout={() => logout.mutate()}
    >
      <Switch>
        <Route path="/verify-email" component={VerifyEmail} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route>
          {auth.isLoading ? (
            <p className="content-section muted-message">Checking your sign-in…</p>
          ) : auth.data?.user ? (
            !auth.data.user.studentId && location !== '/join' ? (
              <Redirect to="/join" />
            ) : (
              <Switch>
                <Route path="/" component={Home} />
                <Route path="/directory" component={Directory} />
                <Route path="/resources" component={Resources} />
                <Route path="/attendance" component={Attendance} />
                <Route path="/profile/:id" component={Profile} />
                <Route path="/join" component={Join} />
                <Route path="/edit/:id" component={EditProfile} />
                <Route component={NotFound} />
              </Switch>
            )
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
      </Switch>
    </Layout>
  );
}

export default function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={base}>
        <Router />
      </WouterRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
