import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { Avatar, Badge, Button, Skeleton, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Primary instructor is always first in the saved userIds array. */
export function orderInstructorIds(selected, primaryId) {
  const ids = [...new Set(selected.filter(Boolean))];
  if (!ids.length) return [];
  const primary = ids.includes(primaryId) ? primaryId : ids[0];
  return [primary, ...ids.filter((id) => id !== primary)];
}

export function CourseInstructorsEditor({ courseId, instructors, readOnly, onSaved }) {
  const auth = useAuth();
  const candidates = useQuery({
    queryKey: ['course-instructor-candidates'],
    queryFn: coursesApi.instructorCandidates,
    enabled: !readOnly,
    staleTime: 60_000,
  });

  const initialIds = useMemo(() => {
    const sorted = [...(instructors ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    return sorted.map((i) => i.id).filter(Boolean);
  }, [instructors]);

  const [selected, setSelected] = useState(initialIds);
  const [primaryId, setPrimaryId] = useState(initialIds[0] ?? null);

  useEffect(() => {
    setSelected(initialIds);
    setPrimaryId(initialIds[0] ?? null);
  }, [initialIds]);

  const ordered = orderInstructorIds(selected, primaryId);
  const dirty = ordered.join(',') !== initialIds.join(',');

  const save = useMutation({
    mutationFn: () => coursesApi.setInstructors(courseId, ordered),
    onSuccess: (data) => {
      toast.success('Instructors updated');
      onSaved?.(data);
    },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((x) => x !== id);
        if (primaryId === id) setPrimaryId(next[0] ?? null);
        return next;
      }
      return [...prev, id];
    });
  };

  if (readOnly) {
    return (
      <div>
        <p className="text-sm font-medium text-fg-2">Instructors</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {(instructors ?? []).map((i) => (
            <Badge key={i.id}>{i.fullName}{i.isPrimary ? ' (primary)' : ''}</Badge>
          ))}
        </div>
      </div>
    );
  }

  const people = (() => {
    const byId = new Map((candidates.data ?? []).map((p) => [p.id, p]));
    for (const i of instructors ?? []) {
      if (i?.id && !byId.has(i.id)) byId.set(i.id, { id: i.id, fullName: i.fullName, email: i.email, role: null });
    }
    return [...byId.values()];
  })();

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-fg-2">Instructors</p>
        <p className="mt-0.5 text-xs text-muted">Choose who teaches this course. The primary instructor is shown first on the landing page.</p>
      </div>

      {candidates.isLoading ? <Skeleton className="h-28" /> : candidates.isError ? (
        <p className="text-sm text-red-600">{candidates.error.message}</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted">
          No staff yet.
          {auth.can('staff.manage') && <> <Link to="/creator/staff" className="font-medium text-primary-600 hover:underline">Invite a teacher</Link> first, then assign them here.</>}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {people.map((p) => {
            const checked = selected.includes(p.id);
            const isPrimary = ordered[0] === p.id;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 rounded border-line-strong accent-primary-600"
                  aria-label={`Assign ${p.fullName}`}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                />
                <Avatar name={p.fullName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{p.fullName}</p>
                  <p className="truncate text-xs text-muted">{p.email}{p.role?.name ? ` · ${p.role.name}` : ''}</p>
                </div>
                {checked && (
                  isPrimary ? (
                    <Badge tone="primary">Primary</Badge>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" leftIcon={Star} onClick={() => setPrimaryId(p.id)}>
                      Make primary
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <Button disabled={!dirty || ordered.length === 0} loading={save.isPending} onClick={() => save.mutate()}>
          Save instructors
        </Button>
      </div>
    </div>
  );
}
