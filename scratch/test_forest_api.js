async function testForestAPI() {
  const apiKey = 'EI/G+F526saHhjTh/vn7tO6CTu66RQObQMzmAMGj+ZIEbdZBW9s7YAYDUCH6uI+b2V4H9UBrosw4QYzUa2VNTA==';
  // Let's try the common Vworld / Forest API
  const url = `http://api.forest.go.kr/openapi/service/trailInfoService/getforestspatialdataservice?serviceKey=${encodeURIComponent(apiKey)}&searchLtnt=37.5665&searchLot=126.9780`;

  console.log(`\n--- Testing Forest API ---`);
  console.log('URL:', url);
  try {
    const response = await fetch(url);
    console.log('Status Code:', response.status);
    
    const text = await response.text();
    console.log('Response Snippet:', text.substring(0, 500));
  } catch (error) {
    console.error('❌ Request Error:', error.message);
  }
}

testForestAPI();
