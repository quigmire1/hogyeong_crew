async function testStandardTrailAPI() {
  const apiKey = 'EI/G+F526saHhjTh/vn7tO6CTu66RQObQMzmAMGj+ZIEbdZBW9s7YAYDUCH6uI+b2V4H9UBrosw4QYzUa2VNTA==';
  // 전국 등산로 표준데이터 API (JSON)
  const url = `https://api.data.go.kr/openapi/tn_pubr_public_mntn_route_api?serviceKey=${encodeURIComponent(apiKey)}&pageNo=1&numOfRows=10&type=json`;

  console.log(`\n--- Testing Standard Trail API ---`);
  console.log('URL:', url);
  try {
    const response = await fetch(url, { headers: { 'Accept': 'application/json' }});
    console.log('Status Code:', response.status);
    
    const text = await response.text();
    console.log('Response Snippet:', text.substring(0, 500));
  } catch (error) {
    console.error('❌ Request Error:', error.message);
  }
}

testStandardTrailAPI();
