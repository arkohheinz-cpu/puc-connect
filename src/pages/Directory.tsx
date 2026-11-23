import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { listDepartments, listStudents } from '../api';
import { StudentCard } from '../components/StudentCard';

const years = ['Level 100', 'Level 200', 'Level 300', 'Level 400', 'Postgraduate', 'Alumni'];

export default function Directory() {
  const [location, navigate] = useLocation();
  const initialQuery = new URLSearchParams(window.location.search).get('q') ?? '';
  const [search, setSearch] = useState(initialQuery);
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState('');
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: listDepartments,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ['students', search, department, year],
    queryFn: () => listStudents({ search, department, year, limit: 100 }),
  });

  useEffect(() => {
    setSearch(new URLSearchParams(window.location.search).get('q') ?? '');
  }, [location]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/directory?q=${encodeURIComponent(query)}` : '/directory');
  }

  return (
    <section className="content-section directory-section">
      <div className="page-heading">
        <span className="eyebrow">Your community</span>
        <h1>Student directory</h1>
        <p>Search and discover people across Pentecost University.</p>
      </div>
      <div className="filter-panel">
        <form className="directory-search" onSubmit={submitSearch}>
          <Search size={19} aria-hidden="true" />
          <input
            aria-label="Search by name, program, or email"
            placeholder="Search by name, program, or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="button button-primary" type="submit">Search</button>
        </form>
        <div className="filter-selects">
          <label>
            <span className="sr-only">Filter by faculty</span>
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">All faculties</option>
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by year</span>
            <select value={year} onChange={(event) => setYear(event.target.value)}>
              <option value="">All years</option>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {(department || year || search) && (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                setDepartment('');
                setYear('');
                setSearch('');
                navigate('/directory');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      {isLoading ? (
        <p className="muted-message">Loading profiles…</p>
      ) : error ? (
        <div className="empty-state"><p className="field-error">{error.message}</p></div>
      ) : data?.length ? (
        <>
          <p className="result-count">{data.length} {data.length === 1 ? 'profile' : 'profiles'} found</p>
          <div className="student-grid">
            {data.map((student) => <StudentCard key={student.id} student={student} />)}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <Users size={28} />
          <h2>No profiles found</h2>
          <p>Try a different search or be the first to add your profile.</p>
        </div>
      )}
    </section>
  );
}
