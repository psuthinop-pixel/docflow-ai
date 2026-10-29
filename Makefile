run-dev:
	python -m http.server 3000

run-backend:
	cd backend && npm install && npm run dev

seed:
	cd backend && npm run seed -- $(EMAIL) $(PASSWORD)

test-backend:
	cd backend && npm test
