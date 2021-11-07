import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/User.entity';
import { UserService } from 'src/user/user.service';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  private accessTokenOptions: any;
  private refreshTokenOptions: any;

  constructor(
    private readonly userService: UserService,
    private readonly config: ConfigService,
    private jwtService: JwtService,
  ) {
    this.accessTokenOptions = {
      secret: this.config.get('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TOKEN_EXPIRATION_TIME'),
      issuer: this.config.get('JWT_ISSUER'),
    };
    this.refreshTokenOptions = {
      secret: this.config.get('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TOKEN_EXPIRATION_TIME'),
      issuer: this.config.get('JWT_ISSUER'),
    };
  }

  /**
   * 엑세스 토큰 발행
   * @param jwtPayload
   * @returns accessToken(jwt)
   */
  issueAccessToken(jwtPayload: object): string {
    return this.jwtService.sign(jwtPayload, this.accessTokenOptions);
  }

  /**
   * 리프레시 토큰 발행
   * @returns refreshToken(jwt)
   */
  issueRefreshToken(): string {
    return this.jwtService.sign({}, this.refreshTokenOptions);
  }

  /**
   * 리프레시 토큰 유효한지 체크
   * @param refreshToken
   * @returns
   */
  isAccessTokenAlive(refreshToken: string) {
    try {
      return this.jwtService.verify(refreshToken, {
        secret: this.refreshTokenOptions.secret,
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * auth signup
   * @param singupDto
   * @returns create user pk
   * @throws ConflictException: username 중복
   */
  async signup(singupDto: SignupDto): Promise<{ id: number }> {
    const { username, password } = singupDto;
    const isExist: boolean = !!(await this.userService.findByUsername(
      username,
    ));
    if (isExist) {
      throw new ConflictException();
    }

    const hashed: string = await bcrypt.hash(
      password,
      this.config.get('BCRYPT_SALT'),
    );

    return this.userService.create({
      ...singupDto,
      password: hashed,
    });
  }

  /**
   * local.strategy.ts에서 사용되는 인증 로직 메서드
   * @param username
   * @param pass - password
   * @returns
   */
  async validateUser(username: string, pass: string): Promise<object | null> {
    const user: User = await this.userService.findByUsername(username);
    if (!user) {
      return null;
      /* 
        Q) UnauthorizedException()  VS  NotFoundException() 어떤것이 맞을까?
        A) http 응답 규칙에 따르면 등록된 유저(자원)가 없기 때문에 404 NotFoundException을 내보내야 한다.
          하지만 인증 로직은 특성상(보안) 모호하게 전달해야 한다. 
          때문에 가입된 유저가 없는 것도, 인증에 실패하는 것도 동일하게 401로 처리한다.
          => 리턴이 null인 경우 local-strategy.ts에서 공통으로 throw new UnauthorizedException()처리한다.
      */
    }

    const isEqual: boolean = await bcrypt.compare(pass, user.password);
    if (isEqual) {
      // Object Destructuring 기법
      const { password, ...result } = user;
      return result;
      // result에는 password를 제외하고 담긴다.
    }
    return null;
  }

  /**
   * login 서비스
   * 1. 엑세스 토큰 발행
   * 2. 리프레시 토큰 발행
   * 3. 엑세스, 리프레시 토큰 DB 저장
   * 4. 리턴
   * @param username
   * @returns {id, username, accessToken}
   */
  async login(username: string): Promise<any> {
    const user: User = await this.userService.findByUsername(username);
    const { id } = user;
    const accessToken: string = this.issueAccessToken({ id });
    const refreshToken: string = this.issueRefreshToken();
    await this.userService.updateTokens(id, accessToken, refreshToken);

    // refresh 토큰은 DB에서 관리
    return {
      id,
      username,
      accessToken,
    };
  }

  /**
   * 엑세스 토큰 재발행
   * 1. id와 엑세스 토큰으로 유저 조회
   * 2. 조회한 유저가 가진 리프레쉬 토큰 유효한지 확인
   * 3. 유효하다면 엑세스 토큰 재발행
   * 4. 재발급한 토큰 DB에 저장
   * 5. 리턴
   * @param id
   * @param accessToken
   * @returns {id, username, accessToken}
   */
  async refresh(id: number, accessToken: string): Promise<any> {
    // user 조회(id와 ccessToken을 사용하여 조회)
    const user = await this.userService.findByToken(id, accessToken);
    if (!user) {
      throw new UnauthorizedException();
    }
    const { username, refreshToken } = user;
    // 조회한 리프레쉬 토큰 유효한지 확인
    const isAlive = !!this.isAccessTokenAlive(refreshToken);
    if (!isAlive) {
      throw new UnauthorizedException();
    }
    // 리프레시 토큰이 유효하다면 엑세스 토큰 재발급
    const newAccessToken = this.issueAccessToken({ id });
    // 재발급한 토큰 저장 DB 저장
    await this.userService.updateTokens(id, accessToken, refreshToken);

    // TODO: redis 추가시 로직 추가
    // 기존 엑세스 토큰은 만료되지 않았을 수 있으니 redis에 등록하여 블랙리스트로 만든다.
    // 리프레시 토큰은 DB에 저장하기 때문에 블랙리스트로 등록할 필요가 없다.

    return {
      id,
      username,
      accessToken: newAccessToken,
    };
  }
}
