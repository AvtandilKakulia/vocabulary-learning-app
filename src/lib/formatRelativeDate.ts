const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function formatRelativeDate(createdAt: string | number | Date): string {
  const createdDate = new Date(createdAt);

  if (Number.isNaN(createdDate.getTime())) {
    return "Added today";
  }

  const now = new Date();
  const diffMs = now.getTime() - createdDate.getTime();

  if (diffMs < 0) {
    return "Added today";
  }

  const days = Math.floor(diffMs / MS_PER_DAY);

  if (days === 0) {
    return "Added today";
  }

  if (days === 1) {
    return "Added yesterday";
  }

  if (days < 7) {
    return `Added ${days} days ago`;
  }

  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return `Added ${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }

  const monthDiff =
    (now.getFullYear() - createdDate.getFullYear()) * 12 +
    (now.getMonth() - createdDate.getMonth());
  const months = Math.max(
    1,
    now.getDate() >= createdDate.getDate() ? monthDiff : monthDiff - 1
  );

  if (months < 12) {
    return `Added ${months} ${months === 1 ? "month" : "months"} ago`;
  }

  const years = Math.max(
    1,
    now.getFullYear() -
      createdDate.getFullYear() -
      (now.getMonth() < createdDate.getMonth() ||
      (now.getMonth() === createdDate.getMonth() &&
        now.getDate() < createdDate.getDate())
        ? 1
        : 0)
  );

  return `Added ${years} ${years === 1 ? "year" : "years"} ago`;
}
