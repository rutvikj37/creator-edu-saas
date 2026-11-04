import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CurriculumBuilder, toOrderPayload } from './CurriculumBuilder.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { coursesApi, uploadFile } from '../../services/api/creator.js';

vi.mock('../../services/api/creator.js', () => ({
  coursesApi: { addSection: vi.fn(), curriculum: vi.fn(), addLesson: vi.fn(), reorder: vi.fn() },
  uploadFile: vi.fn(),
}));

const sections = [
  { id: 's1', title: 'Intro', lessons: [{ id: 'l1', title: 'Welcome', type: 'TEXT', isPublished: true, children: [{ id: 'l2', title: 'Tour', type: 'LINK', isPublished: true }] }] },
  { id: 's2', title: 'Deep dive', lessons: [{ id: 'l3', title: 'Layouts', type: 'VIDEO', isPublished: false, children: [] }] },
];

describe('curriculum', () => {
  it('builds the reorder payload including sub-lessons', () => {
    expect(toOrderPayload(sections)).toEqual([
      { id: 's1', lessons: [{ id: 'l1', children: ['l2'] }] },
      { id: 's2', lessons: [{ id: 'l3', children: [] }] },
    ]);
  });

  it('renders sections, lessons, sub-lessons and draft badges', () => {
    render(<CurriculumBuilder courseId="c1" sections={sections} onChange={() => {}} onEditLesson={() => {}} />);
    expect(screen.getByText('Section 1: Intro')).toBeInTheDocument();
    expect(screen.getByText('Tour')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder section Intro' })).toBeInTheDocument();
  });

  it('adds a section through the API and reloads', async () => {
    coursesApi.addSection.mockResolvedValue({});
    coursesApi.curriculum.mockResolvedValue(sections);
    const onChange = vi.fn();
    render(<CurriculumBuilder courseId="c1" sections={sections} onChange={onChange} onEditLesson={() => {}} />);
    await userEvent.type(screen.getByLabelText('New section title'), 'Projects');
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(coursesApi.addSection).toHaveBeenCalledWith('c1', { title: 'Projects' });
    expect(onChange).toHaveBeenCalledWith(sections);
  });

  it('read-only mode hides editing controls', () => {
    render(<CurriculumBuilder courseId="c1" sections={sections} onChange={() => {}} onEditLesson={() => {}} readOnly />);
    expect(screen.queryByLabelText('New section title')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
  });
});

describe('FileUpload', () => {
  it('shows server validation errors', async () => {
    uploadFile.mockRejectedValue(Object.assign(new Error('Invalid'), { details: [{ field: 'file', message: 'The file content does not match its type or size.' }] }));
    const { container } = render(<FileUpload purpose="LOGO" accept="image/png" onUploaded={() => {}} />);
    await userEvent.upload(container.querySelector('input[type=file]'), new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('The file content does not match its type or size.')).toBeInTheDocument();
  });

  it('reports the uploaded file', async () => {
    uploadFile.mockResolvedValue({ id: 'f1', url: 'http://x/f1', fileName: 'a.png' });
    const onUploaded = vi.fn();
    const { container } = render(<FileUpload purpose="LOGO" accept="image/png" onUploaded={onUploaded} />);
    await userEvent.upload(container.querySelector('input[type=file]'), new File(['x'], 'a.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ id: 'f1', url: 'http://x/f1', fileName: 'a.png' }));
  });
});
