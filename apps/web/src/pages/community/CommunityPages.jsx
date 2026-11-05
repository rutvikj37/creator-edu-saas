import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Flag, Heart, Lock, MessageSquare, MessagesSquare, Pin, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Dropdown, DropdownItem, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { communityApi, membershipsApi } from '../../services/api/community.js';
import { coursesApi } from '../../services/api/creator.js';
import { formatDate } from '../../utils/format.js';

/** Shared feed for students (base '/learn/communities') and staff ('/creator/communities'). */
function useCommunity(staff) {
  return communityApi(staff ? '/creator/communities' : '/learn/communities');
}

function Composer({ api, communityId, onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const post = useMutation({ mutationFn: () => api.createPost(communityId, { title: title || null, body }), onSuccess: () => { setTitle(''); setBody(''); onPosted(); }, onError: (e) => toast.error(e.message) });
  return (
    <Card>
      <CardBody className="space-y-2">
        <Input aria-label="Title" placeholder="Title (optional)" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <Textarea aria-label="Write a post" rows={3} placeholder="Share something with the community" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end"><Button size="sm" disabled={!body.trim()} loading={post.isPending} onClick={() => post.mutate()}>Post</Button></div>
      </CardBody>
    </Card>
  );
}

function PostCard({ post, base, staff, onChanged }) {
  const api = useCommunity(staff);
  const like = useMutation({ mutationFn: () => api.like(post.id), onSuccess: onChanged });
  const mod = useMutation({ mutationFn: (action) => api.moderate(post.id, action), onSuccess: onChanged, onError: (e) => toast.error(e.message) });
  return (
    <Card className={post.hidden ? 'opacity-60' : ''}>
      <CardBody className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted"><span className="font-medium text-fg">{post.author.name}</span>{post.author.staff && <Badge tone="primary" className="ml-1">Team</Badge>} · {formatDate(post.createdAt, { withTime: true })}</div>
          <div className="flex items-center gap-1">
            {post.pinned && <Pin className="size-3.5 text-muted" aria-label="Pinned" />}
            {post.locked && <Lock className="size-3.5 text-muted" aria-label="Locked" />}
            {post.hidden && <Badge>Hidden</Badge>}
            {staff && (
              <Dropdown trigger={(p) => <Button size="sm" variant="ghost" {...p}>Moderate</Button>}>
                <DropdownItem onClick={() => mod.mutate(post.pinned ? 'unpin' : 'pin')}>{post.pinned ? 'Unpin' : 'Pin'}</DropdownItem>
                <DropdownItem onClick={() => mod.mutate(post.locked ? 'unlock' : 'lock')}>{post.locked ? 'Unlock comments' : 'Lock comments'}</DropdownItem>
                <DropdownItem onClick={() => mod.mutate(post.hidden ? 'unhide' : 'hide')}>{post.hidden ? 'Unhide' : 'Hide from students'}</DropdownItem>
              </Dropdown>
            )}
          </div>
        </div>
        <Link to={`${base}/posts/${post.id}`} className="block">
          {post.title && <p className="font-semibold">{post.title}</p>}
          <p className="line-clamp-4 whitespace-pre-line text-sm text-fg-2">{post.body}</p>
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted">
          <button type="button" disabled={staff} onClick={() => like.mutate()} className={`inline-flex items-center gap-1 ${post.likedByMe ? 'text-red-500' : ''}`} aria-label={post.likedByMe ? 'Unlike' : 'Like'}><Heart className={`size-4 ${post.likedByMe ? 'fill-current' : ''}`} />{post.likeCount}</button>
          <Link to={`${base}/posts/${post.id}`} className="inline-flex items-center gap-1"><MessageSquare className="size-4" />{post.commentCount}</Link>
        </div>
      </CardBody>
    </Card>
  );
}

export function CommunityFeedPage({ staff = false }) {
  const { id } = useParams();
  const api = useCommunity(staff);
  const qc = useQueryClient();
  const base = staff ? `/creator/communities/${id}` : `/learn/communities/${id}`;
  const q = useInfiniteQuery({ queryKey: ['community', staff, id], queryFn: ({ pageParam }) => api.posts(id, pageParam), initialPageParam: undefined, getNextPageParam: (last) => last.nextCursor ?? undefined });
  const refresh = () => qc.invalidateQueries({ queryKey: ['community', staff, id] });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const first = q.data?.pages[0];
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title={first?.community.name ?? 'Community'} description={first?.community.description ?? undefined} breadcrumbs={[{ label: 'Communities', to: staff ? '/creator/communities' : '/learn/communities' }, { label: first?.community.name ?? '…' }]} />
      <div className="mx-auto max-w-3xl space-y-4">
        {first && (!first.community.staffOnlyPosts || staff) && <Composer api={api} communityId={id} onPosted={refresh} />}
        {first?.community.staffOnlyPosts && !staff && <Alert tone="info">Only the academy team posts here. You can like and comment.</Alert>}
        {q.isLoading ? <Skeleton className="h-40" /> : posts.length === 0 ? <Card><EmptyState icon={MessagesSquare} title="No posts yet" description="Start the conversation." /></Card> : posts.map((p) => <PostCard key={p.id} post={p} base={base} staff={staff} onChanged={refresh} />)}
        {q.hasNextPage && <div className="text-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
      </div>
    </>
  );
}

export function CommunityPostPage({ staff = false }) {
  const { id, postId } = useParams();
  const api = useCommunity(staff);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(null);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['community-post', staff, postId], queryFn: () => api.post(postId) });
  const set = (d) => qc.setQueryData(['community-post', staff, postId], d);
  const comment = useMutation({ mutationFn: () => api.comment(postId, text), onSuccess: (d) => { set(d); setText(''); }, onError: (e) => toast.error(e.message) });
  const del = useMutation({ mutationFn: () => api.deletePost(postId), onSuccess: () => { toast.success('Post deleted'); navigate(staff ? `/creator/communities/${id}` : `/learn/communities/${id}`); } });
  const hide = useMutation({ mutationFn: ({ cid, hidden }) => api.hideComment(cid, hidden), onSuccess: () => q.refetch() });
  const report = useMutation({ mutationFn: () => api.report({ ...reporting, reason }), onSuccess: () => { toast.success('Thanks — the team will review it'); setReporting(null); setReason(''); } });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const p = q.data;
  if (!p) return <Skeleton className="h-64" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={staff ? `/creator/communities/${id}` : `/learn/communities/${id}`} className="text-sm text-muted hover:text-fg">← Back</Link>
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-2"><p className="text-xs text-muted"><span className="font-medium text-fg">{p.author.name}</span>{p.author.staff && <Badge tone="primary" className="ml-1">Team</Badge>} · {formatDate(p.createdAt, { withTime: true })}</p>
            <span className="flex gap-1">
              {!staff && !p.mine && <Button size="icon-sm" variant="ghost" aria-label="Report post" onClick={() => setReporting({ postId: p.id })}><Flag className="size-4" /></Button>}
              {(p.mine || staff) && <Button size="icon-sm" variant="ghost" aria-label="Delete post" onClick={() => del.mutate()}><Trash2 className="size-4" /></Button>}
            </span>
          </div>
          {p.title && <h1 className="text-xl font-semibold">{p.title}</h1>}
          <p className="whitespace-pre-line text-fg-2">{p.body}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`${p.comments.length} comment${p.comments.length === 1 ? '' : 's'}`} />
        <CardBody className="space-y-3">
          {p.comments.map((c) => (
            <div key={c.id} className={`rounded-lg bg-surface-2 p-3 text-sm ${c.hidden ? 'opacity-60' : ''}`}>
              <div className="mb-1 flex items-center justify-between text-xs text-muted"><span><span className="font-medium text-fg">{c.author.name}</span>{c.author.staff && <Badge tone="primary" className="ml-1">Team</Badge>} · {formatDate(c.createdAt, { withTime: true })}</span>
                <span className="flex gap-1">
                  {!staff && !c.mine && <button type="button" aria-label="Report comment" onClick={() => setReporting({ commentId: c.id })}><Flag className="size-3.5" /></button>}
                  {staff && <button type="button" aria-label={c.hidden ? 'Unhide comment' : 'Hide comment'} onClick={() => hide.mutate({ cid: c.id, hidden: !c.hidden })}><EyeOff className="size-3.5" /></button>}
                </span>
              </div>
              <p className="whitespace-pre-line">{c.body}</p>
            </div>
          ))}
          {p.locked && !staff ? <Alert tone="info">Comments are closed.</Alert> : (
            <div className="flex gap-2"><Textarea aria-label="Write a comment" rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Write a comment" /><Button disabled={!text.trim()} loading={comment.isPending} onClick={() => comment.mutate()}>Reply</Button></div>
          )}
        </CardBody>
      </Card>
      <Modal open={Boolean(reporting)} onClose={() => setReporting(null)} title="Report to the academy team">
        <div className="space-y-3"><Textarea label="What's wrong?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReporting(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} loading={report.isPending} onClick={() => report.mutate()}>Report</Button></div></div>
      </Modal>
    </div>
  );
}

export function StudentCommunitiesPage() {
  const api = useCommunity(false);
  const q = useQuery({ queryKey: ['communities', 'mine'], queryFn: api.spaces });
  return (
    <>
      <PageHeader title="Communities" description="Discuss, ask and learn together." breadcrumbs={[{ label: 'Communities' }]} />
      {q.isLoading ? <Skeleton className="h-40" /> : (q.data ?? []).length === 0 ? <Card><EmptyState icon={MessagesSquare} title="No communities yet" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">{q.data.map((c) => <Link key={c.id} to={`/learn/communities/${c.id}`}><Card className="h-full p-5 transition-shadow hover:shadow-md"><p className="font-semibold">{c.name}</p>{c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}</Card></Link>)}</div>
      )}
    </>
  );
}

function SpaceForm({ onDone }) {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const plans = useQuery({ queryKey: ['memberships', 'plans'], queryFn: membershipsApi.plans });
  const [v, setV] = useState({ name: '', description: '', access: 'ALL_STUDENTS', courseId: '', membershipPlanId: '', staffOnlyPosts: false });
  const api = useCommunity(true);
  const save = useMutation({ mutationFn: () => api.create({ ...v, courseId: v.access === 'COURSE' ? v.courseId : null, membershipPlanId: v.access === 'MEMBERSHIP' ? v.membershipPlanId : null }), onSuccess: () => onDone(true), onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  return (
    <div className="space-y-4">
      <Input label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <Textarea label="Description" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <Select label="Who can join" value={v.access} onChange={(e) => setV({ ...v, access: e.target.value })} options={[{ value: 'ALL_STUDENTS', label: 'All students' }, { value: 'COURSE', label: 'Students of a course' }, { value: 'MEMBERSHIP', label: 'Members of a plan' }]} />
      {v.access === 'COURSE' && <Select label="Course" placeholder="Choose" value={v.courseId} onChange={(e) => setV({ ...v, courseId: e.target.value })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} />}
      {v.access === 'MEMBERSHIP' && <Select label="Membership plan" placeholder="Choose" value={v.membershipPlanId} onChange={(e) => setV({ ...v, membershipPlanId: e.target.value })} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />}
      <Checkbox label="Only the team can post (announcements)" checked={v.staffOnlyPosts} onChange={(e) => setV({ ...v, staffOnlyPosts: e.target.checked })} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button><Button disabled={!v.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Create</Button></div>
    </div>
  );
}

export function CreatorCommunitiesPage() {
  const api = useCommunity(true);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['communities', 'all'], queryFn: api.spaces });
  const reports = useQuery({ queryKey: ['communities', 'reports'], queryFn: api.reports });
  const resolve = useMutation({ mutationFn: api.resolveReport, onSuccess: () => qc.invalidateQueries({ queryKey: ['communities'] }) });
  const hidePost = useMutation({ mutationFn: (postId) => api.moderate(postId, 'hide'), onSuccess: () => qc.invalidateQueries({ queryKey: ['communities'] }) });
  return (
    <>
      <PageHeader title="Communities" description="Spaces for your students to discuss and connect." breadcrumbs={[{ label: 'Growth' }, { label: 'Communities' }]} actions={<Button leftIcon={Plus} onClick={() => setOpen(true)}>New community</Button>} />
      {(reports.data ?? []).length > 0 && (
        <Card className="mb-6">
          <CardHeader title={`Reports (${reports.data.length})`} />
          <CardBody className="divide-y divide-line p-0">{reports.data.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div><p className="font-medium">{r.reason}</p><p className="line-clamp-1 text-muted">{r.comment?.body ?? r.post?.body}</p></div>
              <span className="flex gap-1">{r.postId && <Button size="sm" variant="secondary" onClick={() => hidePost.mutate(r.postId)}>Hide post</Button>}<Button size="sm" variant="ghost" onClick={() => resolve.mutate(r.id)}>Dismiss</Button></span>
            </div>
          ))}</CardBody>
        </Card>
      )}
      <Card>
        <DataTable loading={q.isLoading} error={q.error} rows={q.data?.communities ?? []} onRowClick={(r) => navigate(`/creator/communities/${r.id}`)}
          empty={<EmptyState icon={MessagesSquare} title="No communities yet" description="Create a lounge for everyone, or a space per course or membership." />}
          columns={[
            { key: 'name', header: 'Community', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p>{r.description && <p className="text-xs text-muted">{r.description}</p>}</div> },
            { key: 'access', header: 'Who', cell: (r) => ({ ALL_STUDENTS: 'All students', COURSE: 'Course', MEMBERSHIP: 'Members' })[r.access] },
            { key: 'postCount', header: 'Posts', align: 'right' },
            { key: 'staffOnlyPosts', header: '', cell: (r) => (r.staffOnlyPosts ? <Badge>Announcements</Badge> : null) },
          ]} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New community">{open && <SpaceForm onDone={(ok) => { setOpen(false); if (ok) qc.invalidateQueries({ queryKey: ['communities'] }); }} />}</Modal>
    </>
  );
}
