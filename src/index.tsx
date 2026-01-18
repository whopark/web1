import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// Cloudflare Bindings 타입 정의
type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 분야 분류
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 전체 분야 목록 조회
app.get('/api/categories', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(
    'SELECT * FROM categories ORDER BY sort_order'
  ).all()
  return c.json({ success: true, data: results })
})

// 분야 상세 조회
app.get('/api/categories/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const result = await DB.prepare(
    'SELECT * FROM categories WHERE id = ?'
  ).bind(id).first()
  
  if (!result) {
    return c.json({ success: false, error: '분야를 찾을 수 없습니다' }, 404)
  }
  return c.json({ success: true, data: result })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 담당자 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 전체 담당자 목록 조회
app.get('/api/managers', async (c) => {
  const { DB } = c.env
  const active = c.req.query('active')
  
  let query = 'SELECT * FROM managers'
  if (active === 'true') {
    query += ' WHERE active = 1'
  }
  query += ' ORDER BY name'
  
  const { results } = await DB.prepare(query).all()
  return c.json({ success: true, data: results })
})

// 담당자 상세 조회
app.get('/api/managers/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const result = await DB.prepare(
    'SELECT * FROM managers WHERE id = ?'
  ).bind(id).first()
  
  if (!result) {
    return c.json({ success: false, error: '담당자를 찾을 수 없습니다' }, 404)
  }
  return c.json({ success: true, data: result })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 심사문항 마스터
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 전체 문항 목록 조회 (필터링 지원)
app.get('/api/items', async (c) => {
  const { DB } = c.env
  const { year, type, category_id, status, priority, search } = c.req.query()
  
  let query = `
    SELECT 
      ai.*,
      c.name as category_name,
      m.name as assigned_to_name
    FROM assessment_items ai
    LEFT JOIN categories c ON ai.category_id = c.id
    LEFT JOIN managers m ON ai.assigned_to = m.id
    WHERE 1=1
  `
  const params: any[] = []
  
  if (year) {
    query += ' AND ai.year = ?'
    params.push(year)
  }
  if (type) {
    query += ' AND ai.type = ?'
    params.push(type)
  }
  if (category_id) {
    query += ' AND ai.category_id = ?'
    params.push(category_id)
  }
  if (status) {
    query += ' AND ai.status = ?'
    params.push(status)
  }
  if (priority) {
    query += ' AND ai.priority = ?'
    params.push(priority)
  }
  if (search) {
    query += ' AND (ai.item_number LIKE ? OR ai.title LIKE ? OR ai.content LIKE ?)'
    const searchPattern = `%${search}%`
    params.push(searchPattern, searchPattern, searchPattern)
  }
  
  query += ' ORDER BY ai.item_number'
  
  const { results } = await DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: results, count: results.length })
})

// 문항 상세 조회 (개정이력, 댓글 포함)
app.get('/api/items/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 문항 기본 정보
  const item = await DB.prepare(`
    SELECT 
      ai.*,
      c.name as category_name,
      m.name as assigned_to_name,
      m.email as assigned_to_email
    FROM assessment_items ai
    LEFT JOIN categories c ON ai.category_id = c.id
    LEFT JOIN managers m ON ai.assigned_to = m.id
    WHERE ai.id = ?
  `).bind(id).first()
  
  if (!item) {
    return c.json({ success: false, error: '문항을 찾을 수 없습니다' }, 404)
  }
  
  // 개정 이력
  const { results: revisions } = await DB.prepare(`
    SELECT 
      rh.*,
      m.name as changed_by_name
    FROM revision_history rh
    LEFT JOIN managers m ON rh.changed_by = m.id
    WHERE rh.item_id = ?
    ORDER BY rh.change_date DESC
  `).bind(id).all()
  
  // 댓글
  const { results: comments } = await DB.prepare(`
    SELECT 
      c.*,
      m.name as author_name,
      m.email as author_email
    FROM comments c
    LEFT JOIN managers m ON c.author_id = m.id
    WHERE c.item_id = ?
    ORDER BY c.created_at ASC
  `).bind(id).all()
  
  // 첨부파일
  const { results: attachments } = await DB.prepare(`
    SELECT 
      a.*,
      m.name as uploaded_by_name
    FROM attachments a
    LEFT JOIN managers m ON a.uploaded_by = m.id
    WHERE a.item_id = ?
    ORDER BY a.created_at DESC
  `).bind(id).all()
  
  return c.json({
    success: true,
    data: {
      ...item,
      revisions,
      comments,
      attachments
    }
  })
})

// 문항 생성
app.post('/api/items', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const {
    item_number, year, type, category_id, title, content,
    scoring_method, evaluation_options, status, tags, priority, assigned_to,
    criteria, method, notes
  } = body
  
  try {
    const result = await DB.prepare(`
      INSERT INTO assessment_items (
        item_number, year, type, category_id, title, content,
        scoring_method, evaluation_options, status, tags, priority, assigned_to,
        criteria, method, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item_number, year, type, category_id, title, content,
      scoring_method, evaluation_options, status, tags, priority, assigned_to,
      criteria, method, notes
    ).run()
    
    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// 문항 수정
app.put('/api/items/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const {
    year, type, category_id, title, content,
    scoring_method, evaluation_options, status, tags, priority, assigned_to,
    criteria, method, notes
  } = body
  
  try {
    await DB.prepare(`
      UPDATE assessment_items SET
        year = ?, type = ?, category_id = ?, title = ?, content = ?,
        scoring_method = ?, evaluation_options = ?, status = ?, tags = ?, 
        priority = ?, assigned_to = ?, criteria = ?, method = ?, notes = ?
      WHERE id = ?
    `).bind(
      year, type, category_id, title, content,
      scoring_method, evaluation_options, status, tags, priority, assigned_to,
      criteria, method, notes, id
    ).run()
    
    return c.json({ success: true, message: '문항이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// 문항 삭제
app.delete('/api/items/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  try {
    await DB.prepare('DELETE FROM assessment_items WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '문항이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 개정 이력
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 전체 개정 이력 조회
app.get('/api/revisions', async (c) => {
  const { DB } = c.env
  const { year, item_id, revision_type } = c.req.query()
  
  let query = `
    SELECT 
      rh.*,
      ai.item_number,
      ai.title as item_title,
      m.name as changed_by_name
    FROM revision_history rh
    LEFT JOIN assessment_items ai ON rh.item_id = ai.id
    LEFT JOIN managers m ON rh.changed_by = m.id
    WHERE 1=1
  `
  const params: any[] = []
  
  if (year) {
    query += ' AND rh.year = ?'
    params.push(year)
  }
  if (item_id) {
    query += ' AND rh.item_id = ?'
    params.push(item_id)
  }
  if (revision_type) {
    query += ' AND rh.revision_type = ?'
    params.push(revision_type)
  }
  
  query += ' ORDER BY rh.change_date DESC'
  
  const { results } = await DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: results })
})

// 개정 이력 추가
app.post('/api/revisions', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const {
    item_id, year, revision_type, change_date, effective_date,
    change_description, reason, changed_by
  } = body
  
  try {
    const result = await DB.prepare(`
      INSERT INTO revision_history (
        item_id, year, revision_type, change_date, effective_date,
        change_description, reason, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item_id, year, revision_type, change_date, effective_date,
      change_description, reason, changed_by
    ).run()
    
    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 댓글
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 댓글 추가
app.post('/api/comments', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const { item_id, author_id, content, parent_id } = body
  
  try {
    const result = await DB.prepare(`
      INSERT INTO comments (item_id, author_id, content, parent_id)
      VALUES (?, ?, ?, ?)
    `).bind(item_id, author_id, content, parent_id || null).run()
    
    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// 댓글 삭제
app.delete('/api/comments/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  try {
    await DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '댓글이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 400)
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 엔드포인트: 통계 (대시보드용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/stats', async (c) => {
  const { DB } = c.env
  
  // 전체 문항 수
  const totalItems = await DB.prepare(
    'SELECT COUNT(*) as count FROM assessment_items'
  ).first()
  
  // 유형별 문항 수
  const byType = await DB.prepare(`
    SELECT type, COUNT(*) as count 
    FROM assessment_items 
    GROUP BY type
  `).all()
  
  // 상태별 문항 수
  const byStatus = await DB.prepare(`
    SELECT status, COUNT(*) as count 
    FROM assessment_items 
    GROUP BY status
  `).all()
  
  // 년도별 문항 수
  const byYear = await DB.prepare(`
    SELECT year, COUNT(*) as count 
    FROM assessment_items 
    GROUP BY year 
    ORDER BY year DESC
  `).all()
  
  // 최근 개정 이력
  const recentRevisions = await DB.prepare(`
    SELECT 
      rh.*,
      ai.item_number,
      ai.title as item_title
    FROM revision_history rh
    LEFT JOIN assessment_items ai ON rh.item_id = ai.id
    ORDER BY rh.change_date DESC
    LIMIT 10
  `).all()
  
  return c.json({
    success: true,
    data: {
      totalItems: totalItems?.count || 0,
      byType: byType.results,
      byStatus: byStatus.results,
      byYear: byYear.results,
      recentRevisions: recentRevisions.results
    }
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 페이지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🏥 진단검사의학재단 인증심사 시스템</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    </head>
    <body class="bg-gray-50">
        <div id="app" x-data="appData()" x-init="init()">
            <!-- 헤더 -->
            <header class="bg-white shadow-sm">
                <div class="max-w-7xl mx-auto px-4 py-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <h1 class="text-3xl font-bold text-gray-900">
                                <i class="fas fa-hospital text-blue-600 mr-2"></i>
                                진단검사의학재단 인증심사 시스템
                            </h1>
                            <p class="text-sm text-gray-600 mt-1">2025년 심사문항 관리 시스템</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            <button @click="currentView = 'dashboard'" 
                                    :class="currentView === 'dashboard' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'"
                                    class="px-4 py-2 rounded-lg transition-colors">
                                <i class="fas fa-chart-line mr-2"></i>대시보드
                            </button>
                            <button @click="currentView = 'table'" 
                                    :class="currentView === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'"
                                    class="px-4 py-2 rounded-lg transition-colors">
                                <i class="fas fa-table mr-2"></i>전체 목록
                            </button>
                            <button @click="currentView = 'kanban'" 
                                    :class="currentView === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'"
                                    class="px-4 py-2 rounded-lg transition-colors">
                                <i class="fas fa-columns mr-2"></i>칸반 보드
                            </button>
                            <button @click="currentView = 'gallery'" 
                                    :class="currentView === 'gallery' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'"
                                    class="px-4 py-2 rounded-lg transition-colors">
                                <i class="fas fa-th-large mr-2"></i>갤러리
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <!-- 메인 콘텐츠 -->
            <main class="max-w-7xl mx-auto px-4 py-8">
                <!-- 로딩 상태 -->
                <div x-show="loading" class="text-center py-12">
                    <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
                    <p class="text-gray-600 mt-4">데이터를 불러오는 중...</p>
                </div>

                <!-- 대시보드 뷰 -->
                <div x-show="!loading && currentView === 'dashboard'" x-cloak>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <!-- 통계 카드 -->
                        <div class="bg-white rounded-lg shadow p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-600">전체 문항</p>
                                    <p class="text-3xl font-bold text-gray-900" x-text="stats.totalItems"></p>
                                </div>
                                <i class="fas fa-file-alt text-4xl text-blue-500"></i>
                            </div>
                        </div>
                        
                        <div class="bg-white rounded-lg shadow p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-600">핵심C</p>
                                    <p class="text-3xl font-bold text-red-600" x-text="getTypeCount('핵심C')"></p>
                                </div>
                                <i class="fas fa-star text-4xl text-red-500"></i>
                            </div>
                        </div>
                        
                        <div class="bg-white rounded-lg shadow p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-600">필수R</p>
                                    <p class="text-3xl font-bold text-orange-600" x-text="getTypeCount('필수R')"></p>
                                </div>
                                <i class="fas fa-exclamation-circle text-4xl text-orange-500"></i>
                            </div>
                        </div>
                        
                        <div class="bg-white rounded-lg shadow p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-600">기본B</p>
                                    <p class="text-3xl font-bold text-blue-600" x-text="getTypeCount('기본B')"></p>
                                </div>
                                <i class="fas fa-check-circle text-4xl text-blue-500"></i>
                            </div>
                        </div>
                    </div>

                    <!-- 최근 개정 이력 -->
                    <div class="bg-white rounded-lg shadow p-6">
                        <h2 class="text-xl font-bold text-gray-900 mb-4">
                            <i class="fas fa-history text-blue-600 mr-2"></i>
                            최근 개정 이력
                        </h2>
                        <div class="space-y-3">
                            <template x-for="revision in stats.recentRevisions" :key="revision.id">
                                <div class="border-l-4 border-blue-500 pl-4 py-2">
                                    <div class="flex items-start justify-between">
                                        <div>
                                            <span class="font-semibold text-gray-900" x-text="revision.item_number"></span>
                                            <span class="text-gray-600 ml-2" x-text="revision.item_title"></span>
                                            <p class="text-sm text-gray-500 mt-1" x-text="revision.change_description"></p>
                                        </div>
                                        <span class="px-3 py-1 text-xs rounded-full"
                                              :class="{
                                                '신규': 'bg-green-100 text-green-800',
                                                '수정': 'bg-blue-100 text-blue-800',
                                                '삭제': 'bg-red-100 text-red-800'
                                              }[revision.revision_type]"
                                              x-text="revision.revision_type">
                                        </span>
                                    </div>
                                    <p class="text-xs text-gray-400 mt-2" x-text="revision.change_date"></p>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>

                <!-- 테이블 뷰 -->
                <div x-show="!loading && currentView === 'table'" x-cloak>
                    <div class="bg-white rounded-lg shadow">
                        <!-- 필터 -->
                        <div class="p-6 border-b">
                            <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
                                <input type="text" x-model="filters.search" @input="loadItems()" 
                                       placeholder="검색 (문항번호, 제목...)"
                                       class="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                                
                                <select x-model="filters.year" @change="loadItems()" 
                                        class="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="">전체 년도</option>
                                    <option value="2025">2025</option>
                                    <option value="2024">2024</option>
                                    <option value="2023">2023</option>
                                </select>
                                
                                <select x-model="filters.type" @change="loadItems()" 
                                        class="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="">전체 유형</option>
                                    <option value="핵심C">핵심C</option>
                                    <option value="필수R">필수R</option>
                                    <option value="기본B">기본B</option>
                                </select>
                                
                                <select x-model="filters.status" @change="loadItems()" 
                                        class="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="">전체 상태</option>
                                    <option value="🟢 사용중">🟢 사용중</option>
                                    <option value="🟡 검토중">🟡 검토중</option>
                                    <option value="🔴 폐기됨">🔴 폐기됨</option>
                                </select>
                                
                                <select x-model="filters.priority" @change="loadItems()" 
                                        class="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="">전체 우선순위</option>
                                    <option value="높음">높음</option>
                                    <option value="보통">보통</option>
                                    <option value="낮음">낮음</option>
                                </select>
                            </div>
                        </div>

                        <!-- 테이블 -->
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">문항번호</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">년도</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">유형</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">분야</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">제목</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">우선순위</th>
                                    </tr>
                                </thead>
                                <tbody class="bg-white divide-y divide-gray-200">
                                    <template x-for="item in items" :key="item.id">
                                        <tr class="hover:bg-gray-50 cursor-pointer" @click="viewItemDetail(item.id)">
                                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900" x-text="item.item_number"></td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500" x-text="item.year"></td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <span class="px-2 py-1 text-xs rounded-full"
                                                      :class="{
                                                        '핵심C': 'bg-red-100 text-red-800',
                                                        '필수R': 'bg-orange-100 text-orange-800',
                                                        '기본B': 'bg-blue-100 text-blue-800'
                                                      }[item.type]"
                                                      x-text="item.type">
                                                </span>
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500" x-text="item.category_name"></td>
                                            <td class="px-6 py-4 text-sm text-gray-900" x-text="item.title"></td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm" x-text="item.status"></td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <span class="px-2 py-1 text-xs rounded-full"
                                                      :class="{
                                                        '높음': 'bg-red-100 text-red-800',
                                                        '보통': 'bg-yellow-100 text-yellow-800',
                                                        '낮음': 'bg-green-100 text-green-800'
                                                      }[item.priority]"
                                                      x-text="item.priority">
                                                </span>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="px-6 py-4 bg-gray-50 border-t">
                            <p class="text-sm text-gray-600">
                                총 <span class="font-semibold" x-text="items.length"></span>개 문항
                            </p>
                        </div>
                    </div>
                </div>

                <!-- 칸반 뷰 -->
                <div x-show="!loading && currentView === 'kanban'" x-cloak>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <!-- 핵심C -->
                        <div class="bg-white rounded-lg shadow">
                            <div class="bg-red-500 text-white px-6 py-4 rounded-t-lg">
                                <h3 class="text-lg font-bold">
                                    <i class="fas fa-star mr-2"></i>핵심C
                                    <span class="ml-2 text-sm">(<span x-text="getItemsByType('핵심C').length"></span>)</span>
                                </h3>
                            </div>
                            <div class="p-4 space-y-3 max-h-[600px] overflow-y-auto">
                                <template x-for="item in getItemsByType('핵심C')" :key="item.id">
                                    <div class="bg-gray-50 rounded-lg p-4 border-l-4 border-red-500 hover:shadow-md transition-shadow cursor-pointer"
                                         @click="viewItemDetail(item.id)">
                                        <div class="font-semibold text-gray-900 mb-2" x-text="item.item_number"></div>
                                        <div class="text-sm text-gray-700 mb-2" x-text="item.title"></div>
                                        <div class="flex items-center justify-between">
                                            <span class="text-xs text-gray-500" x-text="item.category_name"></span>
                                            <span class="text-xs px-2 py-1 rounded-full"
                                                  :class="{
                                                    '높음': 'bg-red-100 text-red-800',
                                                    '보통': 'bg-yellow-100 text-yellow-800',
                                                    '낮음': 'bg-green-100 text-green-800'
                                                  }[item.priority]"
                                                  x-text="item.priority">
                                            </span>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </div>

                        <!-- 필수R -->
                        <div class="bg-white rounded-lg shadow">
                            <div class="bg-orange-500 text-white px-6 py-4 rounded-t-lg">
                                <h3 class="text-lg font-bold">
                                    <i class="fas fa-exclamation-circle mr-2"></i>필수R
                                    <span class="ml-2 text-sm">(<span x-text="getItemsByType('필수R').length"></span>)</span>
                                </h3>
                            </div>
                            <div class="p-4 space-y-3 max-h-[600px] overflow-y-auto">
                                <template x-for="item in getItemsByType('필수R')" :key="item.id">
                                    <div class="bg-gray-50 rounded-lg p-4 border-l-4 border-orange-500 hover:shadow-md transition-shadow cursor-pointer"
                                         @click="viewItemDetail(item.id)">
                                        <div class="font-semibold text-gray-900 mb-2" x-text="item.item_number"></div>
                                        <div class="text-sm text-gray-700 mb-2" x-text="item.title"></div>
                                        <div class="flex items-center justify-between">
                                            <span class="text-xs text-gray-500" x-text="item.category_name"></span>
                                            <span class="text-xs px-2 py-1 rounded-full"
                                                  :class="{
                                                    '높음': 'bg-red-100 text-red-800',
                                                    '보통': 'bg-yellow-100 text-yellow-800',
                                                    '낮음': 'bg-green-100 text-green-800'
                                                  }[item.priority]"
                                                  x-text="item.priority">
                                            </span>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </div>

                        <!-- 기본B -->
                        <div class="bg-white rounded-lg shadow">
                            <div class="bg-blue-500 text-white px-6 py-4 rounded-t-lg">
                                <h3 class="text-lg font-bold">
                                    <i class="fas fa-check-circle mr-2"></i>기본B
                                    <span class="ml-2 text-sm">(<span x-text="getItemsByType('기본B').length"></span>)</span>
                                </h3>
                            </div>
                            <div class="p-4 space-y-3 max-h-[600px] overflow-y-auto">
                                <template x-for="item in getItemsByType('기본B')" :key="item.id">
                                    <div class="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 hover:shadow-md transition-shadow cursor-pointer"
                                         @click="viewItemDetail(item.id)">
                                        <div class="font-semibold text-gray-900 mb-2" x-text="item.item_number"></div>
                                        <div class="text-sm text-gray-700 mb-2" x-text="item.title"></div>
                                        <div class="flex items-center justify-between">
                                            <span class="text-xs text-gray-500" x-text="item.category_name"></span>
                                            <span class="text-xs px-2 py-1 rounded-full"
                                                  :class="{
                                                    '높음': 'bg-red-100 text-red-800',
                                                    '보통': 'bg-yellow-100 text-yellow-800',
                                                    '낮음': 'bg-green-100 text-green-800'
                                                  }[item.priority]"
                                                  x-text="item.priority">
                                            </span>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 갤러리 뷰 -->
                <div x-show="!loading && currentView === 'gallery'" x-cloak>
                    <div class="mb-6">
                        <h2 class="text-2xl font-bold text-gray-900 mb-4">
                            <i class="fas fa-sparkles text-yellow-500 mr-2"></i>
                            2025 개정사항 갤러리
                        </h2>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <template x-for="item in get2025NewItems()" :key="item.id">
                            <div class="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow cursor-pointer"
                                 @click="viewItemDetail(item.id)">
                                <div class="h-32 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                                    <i class="fas fa-file-medical text-white text-5xl"></i>
                                </div>
                                <div class="p-6">
                                    <div class="flex items-center justify-between mb-3">
                                        <span class="text-sm font-semibold text-gray-900" x-text="item.item_number"></span>
                                        <span class="px-2 py-1 text-xs rounded-full"
                                              :class="{
                                                '핵심C': 'bg-red-100 text-red-800',
                                                '필수R': 'bg-orange-100 text-orange-800',
                                                '기본B': 'bg-blue-100 text-blue-800'
                                              }[item.type]"
                                              x-text="item.type">
                                        </span>
                                    </div>
                                    <h3 class="text-lg font-bold text-gray-900 mb-2" x-text="item.title"></h3>
                                    <p class="text-sm text-gray-600 mb-4" x-text="item.category_name"></p>
                                    <div class="flex flex-wrap gap-2">
                                        <template x-for="tag in parseJSON(item.tags)" :key="tag">
                                            <span class="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full" x-text="tag"></span>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            </main>

            <!-- 상세 모달 (간단한 알림) -->
            <div x-show="selectedItem" 
                 @click="selectedItem = null"
                 class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" 
                 style="display: none;">
                <div @click.stop class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                    <div class="p-6">
                        <div class="flex items-center justify-between mb-6">
                            <h2 class="text-2xl font-bold text-gray-900">문항 상세 정보</h2>
                            <button @click="selectedItem = null" class="text-gray-500 hover:text-gray-700">
                                <i class="fas fa-times text-2xl"></i>
                            </button>
                        </div>
                        <template x-if="selectedItem">
                            <div>
                                <div class="bg-blue-50 rounded-lg p-4 mb-6">
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <span class="text-sm text-gray-600">문항번호:</span>
                                            <span class="ml-2 font-semibold" x-text="selectedItem.item_number"></span>
                                        </div>
                                        <div>
                                            <span class="text-sm text-gray-600">년도:</span>
                                            <span class="ml-2 font-semibold" x-text="selectedItem.year"></span>
                                        </div>
                                        <div>
                                            <span class="text-sm text-gray-600">유형:</span>
                                            <span class="ml-2 px-2 py-1 text-xs rounded-full"
                                                  :class="{
                                                    '핵심C': 'bg-red-100 text-red-800',
                                                    '필수R': 'bg-orange-100 text-orange-800',
                                                    '기본B': 'bg-blue-100 text-blue-800'
                                                  }[selectedItem.type]"
                                                  x-text="selectedItem.type">
                                            </span>
                                        </div>
                                        <div>
                                            <span class="text-sm text-gray-600">분야:</span>
                                            <span class="ml-2 font-semibold" x-text="selectedItem.category_name"></span>
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-6">
                                    <h3 class="text-lg font-bold text-gray-900 mb-2">제목</h3>
                                    <p class="text-gray-700" x-text="selectedItem.title"></p>
                                </div>

                                <div class="mb-6">
                                    <h3 class="text-lg font-bold text-gray-900 mb-2">내용</h3>
                                    <p class="text-gray-700" x-text="selectedItem.content || '내용 없음'"></p>
                                </div>

                                <div class="mb-6" x-show="selectedItem.revisions && selectedItem.revisions.length > 0">
                                    <h3 class="text-lg font-bold text-gray-900 mb-3">
                                        <i class="fas fa-history text-blue-600 mr-2"></i>개정 이력
                                    </h3>
                                    <div class="space-y-3">
                                        <template x-for="revision in selectedItem.revisions" :key="revision.id">
                                            <div class="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded">
                                                <div class="flex items-start justify-between mb-2">
                                                    <span class="px-2 py-1 text-xs rounded-full"
                                                          :class="{
                                                            '신규': 'bg-green-100 text-green-800',
                                                            '수정': 'bg-blue-100 text-blue-800',
                                                            '삭제': 'bg-red-100 text-red-800'
                                                          }[revision.revision_type]"
                                                          x-text="revision.revision_type">
                                                    </span>
                                                    <span class="text-sm text-gray-600" x-text="revision.change_date"></span>
                                                </div>
                                                <p class="text-sm text-gray-700" x-text="revision.change_description"></p>
                                                <p class="text-xs text-gray-500 mt-1" x-text="'사유: ' + revision.reason"></p>
                                            </div>
                                        </template>
                                    </div>
                                </div>

                                <div x-show="selectedItem.comments && selectedItem.comments.length > 0">
                                    <h3 class="text-lg font-bold text-gray-900 mb-3">
                                        <i class="fas fa-comments text-blue-600 mr-2"></i>댓글
                                    </h3>
                                    <div class="space-y-3">
                                        <template x-for="comment in selectedItem.comments" :key="comment.id">
                                            <div class="bg-gray-50 rounded-lg p-4">
                                                <div class="flex items-center mb-2">
                                                    <i class="fas fa-user-circle text-gray-400 text-xl mr-2"></i>
                                                    <span class="font-semibold text-gray-900" x-text="comment.author_name"></span>
                                                    <span class="text-xs text-gray-500 ml-auto" x-text="comment.created_at"></span>
                                                </div>
                                                <p class="text-sm text-gray-700" x-text="comment.content"></p>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <script>
            function appData() {
                return {
                    loading: true,
                    currentView: 'dashboard',
                    items: [],
                    stats: {
                        totalItems: 0,
                        byType: [],
                        byStatus: [],
                        byYear: [],
                        recentRevisions: []
                    },
                    filters: {
                        search: '',
                        year: '',
                        type: '',
                        status: '',
                        priority: ''
                    },
                    selectedItem: null,

                    async init() {
                        await this.loadStats()
                        await this.loadItems()
                        this.loading = false
                    },

                    async loadStats() {
                        try {
                            const response = await axios.get('/api/stats')
                            if (response.data.success) {
                                this.stats = response.data.data
                            }
                        } catch (error) {
                            console.error('통계 로딩 실패:', error)
                        }
                    },

                    async loadItems() {
                        try {
                            const params = new URLSearchParams()
                            if (this.filters.search) params.append('search', this.filters.search)
                            if (this.filters.year) params.append('year', this.filters.year)
                            if (this.filters.type) params.append('type', this.filters.type)
                            if (this.filters.status) params.append('status', this.filters.status)
                            if (this.filters.priority) params.append('priority', this.filters.priority)

                            const response = await axios.get('/api/items?' + params.toString())
                            if (response.data.success) {
                                this.items = response.data.data
                            }
                        } catch (error) {
                            console.error('문항 로딩 실패:', error)
                        }
                    },

                    async viewItemDetail(id) {
                        try {
                            const response = await axios.get(\`/api/items/\${id}\`)
                            if (response.data.success) {
                                this.selectedItem = response.data.data
                            }
                        } catch (error) {
                            console.error('상세 정보 로딩 실패:', error)
                        }
                    },

                    getTypeCount(type) {
                        const found = this.stats.byType.find(item => item.type === type)
                        return found ? found.count : 0
                    },

                    getItemsByType(type) {
                        return this.items.filter(item => item.type === type)
                    },

                    get2025NewItems() {
                        return this.items.filter(item => {
                            const tags = this.parseJSON(item.tags)
                            return item.year === '2025' && (tags.includes('신규') || tags.includes('수정'))
                        })
                    },

                    parseJSON(str) {
                        try {
                            return JSON.parse(str || '[]')
                        } catch {
                            return []
                        }
                    }
                }
            }
        </script>

        <style>
            [x-cloak] { display: none !important; }
        </style>
    </body>
    </html>
  `)
})

export default app
