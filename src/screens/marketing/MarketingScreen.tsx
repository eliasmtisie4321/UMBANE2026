import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import { CHANNEL_LABEL } from '@shared/integrations'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { ShareDialog } from '@/components/share/ShareDialog'
import { MessageStatusBadge } from '@/components/messages/MessageStatusBadge'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listSocialPosts } from '@/services/marketing'
import { formatDateTime } from '@/utils/format'

/**
 * Marketing: public posts to the business's Facebook Page, Instagram and LinkedIn, through the
 * connections in Settings → Integrations. Posts never carry customer records or private
 * documents; direct messages to customers go from their records instead.
 */
export default function MarketingScreen() {
  const [version, setVersion] = useState(0)
  const [composing, setComposing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const posts = useResource(() => listSocialPosts(), `posts-${version}`)
  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Publish to your social media pages, and see what went out."
        actions={
          <Button onClick={() => setComposing(true)}>
            <Megaphone size={16} aria-hidden="true" /> New Post
          </Button>
        }
      />
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface"
        >
          {notice}
        </p>
      )}
      <section
        aria-labelledby="posts"
        className="rounded-lg border border-outline-variant bg-surface p-4 shadow-card"
      >
        <h2 id="posts" className="mb-3 text-title-md font-semibold text-on-surface">
          Posts
        </h2>
        <ResourceBoundary
          state={posts}
          isEmpty={(rows) => rows.length === 0}
          empty={
            <p className="text-body-md text-on-surface-variant">
              No posts yet. Use New Post to publish one.
            </p>
          }
        >
          {(rows) => (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-on-surface">{CHANNEL_LABEL[p.channel]}</span>
                    {p.sender && (
                      <span className="text-label-md text-on-surface-variant">{p.sender}</span>
                    )}
                    <MessageStatusBadge status={p.status} />
                    <span className="text-label-md text-on-surface-variant">
                      {formatDateTime(p.createdAt)}
                    </span>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-body-md text-on-surface">
                    {p.body}
                  </p>
                  {p.error && <p className="text-label-md text-error">{p.error}</p>}
                  {p.externalUrl && (
                    <a
                      href={p.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-label-md text-primary underline"
                    >
                      See the post on {CHANNEL_LABEL[p.channel]}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ResourceBoundary>
      </section>
      {composing && (
        <ShareDialog
          mode="social"
          context={{ title: 'New post' }}
          onClose={() => setComposing(false)}
          onDone={(text) => {
            setComposing(false)
            setNotice(text)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </>
  )
}
