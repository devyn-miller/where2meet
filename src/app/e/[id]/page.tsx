import { EventApp } from "@/components/EventApp";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventApp eventId={id} />;
}
