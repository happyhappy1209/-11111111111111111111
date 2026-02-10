# GradSim (Static) — Vercel 배포용

이 프로젝트는 **정적(Static) 웹사이트**라서, GitHub에 올린 뒤 Vercel에 연결하면 바로 배포됩니다.

## 1) 로컬에서 확인(선택)
VS Code 설치 → 이 폴더 열기 → 아래 중 하나:

- (가장 쉬움) VS Code 확장: **Live Server** 설치 → `index.html` 우클릭 → Open with Live Server
- 또는 Python이 있으면: `python -m http.server 5173` → 브라우저에서 `http://localhost:5173`

## 2) GitHub에 올리기
1. GitHub에서 새 저장소(Repository) 만들기 (Public 추천)
2. 이 폴더 안 파일을 그대로 업로드
   - `index.html`, `app.js`, `styles.css`, `vercel.json`
   - `data/` 폴더 포함 (courses.json, requirements.json)

## 3) Vercel 배포
1. Vercel 로그인 → **Add New → Project**
2. GitHub 저장소 선택 → Import
3. Framework Preset: **Other**
4. Build Command: 비움(없음)
5. Output Directory: 비움(루트)
6. Deploy 클릭

배포 완료되면 링크가 생깁니다.

## 4) 졸업요건/과목 수정
- `data/requirements.json`: 학번별 졸업요건(학점, 지정과목 등)
- `data/courses.json`: 자동검색/자동학점 입력에 쓰는 과목 목록

> 학교 규정 업데이트가 있으면 이 두 파일만 업데이트하면 됩니다.
