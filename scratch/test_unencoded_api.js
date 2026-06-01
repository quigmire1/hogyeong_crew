async function testKMAUnencoded() {
  const apiKey = 'EI/G+F526saHhjTh/vn7tO6CTu66RQObQMzmAMGj+ZIEbdZBW9s7YAYDUCH6uI+b2V4H9UBrosw4QYzUa2VNTA==';
  const baseUrl = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst';
  
  // URL exactly as constructed in utils/weather.ts
  const url = `${baseUrl}?serviceKey=${apiKey}&pageNo=1&numOfRows=10&dataType=JSON&base_date=20260509&base_time=0930&nx=60&ny=127`;

  console.log(`\n--- Testing Unencoded API Key ---`);
  console.log('URL:', url);
  try {
    const response = await fetch(url);
    console.log('Status Code:', response.status);
    
    const text = await response.text();
    console.log('Response Snippet:', text.substring(0, 200));
  } catch (error) {
    console.error('❌ Request Error:', error.message);
  }
}

testKMAUnencoded();
